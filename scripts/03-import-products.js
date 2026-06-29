/**
 * Step 6 of the import sequence: import products.
 *
 * Reads sheets/atx-prod-test-01_sheet_products.csv (152 rows -> 140 products), groups
 * parent + continuation rows, and creates each product via productSet:
 *   - productOptions in Formula -> Size -> Flavor order, with the linked-metafield
 *     approach for shopify.flavor / shopify.food-supplement-form option values
 *   - variants (price, sku, cost, variant_title metafield, variant image)
 *   - product metafields (supplement_category, supplement_size, product_details,
 *     supplement_ingredients, and shopify.flavor / shopify.food-supplement-form when
 *     not covered by a linked option)
 *   - product image with generated SEO alt text
 *   - assignment to the Supplements collection
 *   - status: DRAFT, published to every available sales channel (publishablePublish)
 *
 * Publishing requires the read_publications/write_publications scopes. If they aren't
 * granted yet, the publications lookup fails gracefully (logged once) and the run
 * proceeds without publishing — products are still created as DRAFT and unpublished.
 *
 * Usage:
 *   node --env-file=.env scripts/03-import-products.js [--dry-run] [--limit=N] [--handles=a,b,c] [--publish-only]
 *
 * --publish-only: skip product creation and just publish existing products (matched by
 * handle) to all available channels. Use this to backfill publishing once the
 * publications scopes are granted, without re-running the full import.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { graphql } from '../api.js';
import { logUserErrors } from './lib/log.js';
import { parseCSVObjects } from './lib/csv.js';
import { groupProducts } from './lib/products.js';
import { lookupId, lookupEntry } from './lib/text.js';
import { htmlToRichText } from './lib/richtext.js';
import { productImageAlt, variantImageAlt } from './lib/alttext.js';
import { withRetry } from './lib/throttle.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHEETS_DIR = path.join(__dirname, '..', 'sheets');
const DATA_DIR = path.join(__dirname, 'data');
const METAOBJECT_IDS_FILE = `metaobject-ids.${process.env.SHOPIFY_SHOP}.json`;

// "Health & Beauty > Health Care > Fitness & Nutrition > Vitamins & Supplements"
const VITAMINS_SUPPLEMENTS_CATEGORY = 'gid://shopify/TaxonomyCategory/hb-1-9-6';
// "Supplements" collection — looked up by handle so this script runs unmodified on any store.
const SUPPLEMENTS_COLLECTION_HANDLE = 'supplements';

const CATEGORY_COL = 'Supplement categories\n(product.metafields.custom.supplement_category)';
const SIZE_COL = 'Supplement size\n(product.metafields.custom.supplement_size)';
const FLAVOR_COL = 'Flavor\n(product.metafields.shopify.flavor)';
const FORM_COL = 'Food supplement form\n(product.metafields.shopify.food-supplement-form)';
const DETAILS_COL = 'Product details\n(product.metafields.custom.product_details)';
const INGREDIENTS_COL = 'Supplement ingredients\n(product.metafields.custom.supplement_ingredients)';
const VARIANT_TITLE_COL = 'Variant product title\n(variant.metafields.custom.variant_title)';

const OPTION_LINK_MAP = {
	'product.metafields.shopify.food-supplement-form': { namespace: 'shopify', key: 'food-supplement-form', refMap: 'forms' },
	'product.metafields.shopify.flavor': { namespace: 'shopify', key: 'flavor', refMap: 'flavors' },
};

const PRODUCT_SET = `
mutation ProductSet($input: ProductSetInput!, $synchronous: Boolean!, $identifier: ProductSetIdentifiers) {
  productSet(synchronous: $synchronous, input: $input, identifier: $identifier) {
    product { id title handle }
    userErrors { field message code }
  }
}`;

const PUBLICATIONS_QUERY = `{ publications(first: 20) { nodes { id name } } }`;

const COLLECTION_BY_HANDLE = `
query CollectionByHandle($handle: String!) {
  collectionByHandle(handle: $handle) { id }
}`;

const PRODUCT_BY_HANDLE = `
query ProductByHandle($handle: String!) {
  productByHandle(handle: $handle) { id }
}`;

const PUBLISHABLE_PUBLISH = `
mutation PublishablePublish($id: ID!, $input: [PublicationInput!]!) {
  publishablePublish(id: $id, input: $input) {
    userErrors { field message }
  }
}`;

/** Fetch every available publication (sales channel), or null if the publications scope isn't granted. */
async function fetchPublicationIds() {
	try {
		const data = await graphql(PUBLICATIONS_QUERY);
		const publications = data.publications.nodes;
		console.log(`Publishing to ${publications.length} channel(s): ${publications.map((p) => p.name).join(', ')}\n`);
		return publications.map((p) => p.id);
	} catch (err) {
		if (!/ACCESS_DENIED/.test(err.message)) throw err;
		console.log('Skipping channel publishing — read_publications/write_publications scopes not granted (see CLAUDE.md).\n');
		return null;
	}
}

/** Publish a product to every channel in publicationIds. Products stay DRAFT; only channel visibility changes. */
async function publishToAllChannels(productId, publicationIds) {
	const data = await withRetry(() =>
		graphql(PUBLISHABLE_PUBLISH, { id: productId, input: publicationIds.map((publicationId) => ({ publicationId })) }),
	);
	return data.publishablePublish.userErrors;
}

/** Look up the "Supplements" collection by handle so the script needs no per-store IDs. */
async function fetchSupplementsCollectionId() {
	const data = await graphql(COLLECTION_BY_HANDLE, { handle: SUPPLEMENTS_COLLECTION_HANDLE });
	if (!data.collectionByHandle) {
		throw new Error(`Collection with handle "${SUPPLEMENTS_COLLECTION_HANDLE}" not found`);
	}
	return data.collectionByHandle.id;
}

function splitList(value) {
	return (value || '').split(',').map((s) => s.trim()).filter(Boolean);
}

/** Build productOptions (Formula -> Size -> Flavor order) and the per-option metadata needed for variants. */
function buildOptions(group, ids) {
	const parent = group.parent;
	const optionDefs = [];
	for (let i = 1; i <= 3; i++) {
		const name = parent[`Option${i} Name`];
		if (!name || name === 'Title') continue;
		optionDefs.push({
			csvIndex: i,
			name,
			linkedTo: parent[`Option${i} Linked To`] || null,
			values: [],
		});
	}
	for (const def of optionDefs) {
		for (const row of group.rows) {
			const val = row[`Option${def.csvIndex} Value`];
			if (val && !def.values.includes(val)) def.values.push(val);
		}
	}
	const productOptions = optionDefs.map((def, idx) => {
		const opt = { name: def.name, position: idx + 1 };
		if (def.linkedTo) {
			const link = OPTION_LINK_MAP[def.linkedTo];
			const entries = def.values.map((v) => lookupEntry(ids[link.refMap], v, `${link.namespace}.${link.key}`));
			// Shopify names linked option values after the metaobject's label, not the raw CSV value.
			def.valueLabels = new Map(def.values.map((v, i) => [v, entries[i][0]]));
			// Variants reference linked option values by metaobject GID via linkedMetafieldValue.
			def.valueGids = new Map(def.values.map((v, i) => [v, entries[i][1]]));
			opt.linkedMetafield = {
				namespace: link.namespace,
				key: link.key,
				values: entries.map(([, id]) => id),
			};
		} else {
			opt.values = def.values.map((v) => ({ name: v }));
		}
		return opt;
	});
	return { optionDefs, productOptions };
}

function buildOptionValues(row, optionDefs) {
	if (optionDefs.length === 0) return [{ optionName: 'Title', name: 'Default Title' }];
	return optionDefs.map((def) => {
		const raw = row[`Option${def.csvIndex} Value`];
		const name = def.valueLabels ? def.valueLabels.get(raw) : raw;
		const optionValue = { optionName: def.name, name };
		if (def.valueGids) optionValue.linkedMetafieldValue = def.valueGids.get(raw);
		return optionValue;
	});
}

/** Push a metaobject-reference-list metafield (e.g. shopify.flavor) unless an option already links to it. */
function pushMetaobjectListMetafield(metafields, optionDefs, linkedTo, csvValue, idMap, { namespace, key }) {
	if (optionDefs.some((d) => d.linkedTo === linkedTo)) return;
	const names = splitList(csvValue);
	if (!names.length) return;
	metafields.push({ namespace, key, value: JSON.stringify(names.map((n) => lookupId(idMap, n, key))) });
}

function buildProductMetafields(parent, ids, optionDefs) {
	const metafields = [];

	const categories = splitList(parent[CATEGORY_COL]);
	metafields.push({
		namespace: 'custom',
		key: 'supplement_category',
		value: JSON.stringify(categories.map((c) => lookupId(ids.categories, c, 'supplement_category'))),
	});

	const size = (parent[SIZE_COL] || '').trim();
	if (size) {
		metafields.push({ namespace: 'custom', key: 'supplement_size', value: JSON.stringify([size]) });
	}

	metafields.push({ namespace: 'custom', key: 'product_details', value: JSON.stringify(htmlToRichText(parent[DETAILS_COL])) });
	metafields.push({ namespace: 'custom', key: 'supplement_ingredients', value: JSON.stringify(htmlToRichText(parent[INGREDIENTS_COL])) });

	pushMetaobjectListMetafield(metafields, optionDefs, 'product.metafields.shopify.flavor', parent[FLAVOR_COL], ids.flavors, {
		namespace: 'shopify',
		key: 'flavor',
	});
	pushMetaobjectListMetafield(metafields, optionDefs, 'product.metafields.shopify.food-supplement-form', parent[FORM_COL], ids.forms, {
		namespace: 'shopify',
		key: 'food-supplement-form',
	});

	return metafields;
}

function buildVariant(row, optionDefs, productTitle) {
	const variant = {
		optionValues: buildOptionValues(row, optionDefs),
		price: row['Variant Price'],
		inventoryItem: { cost: row['Cost per item'] },
	};
	if (row['SKU']) variant.sku = row['SKU'];

	const variantTitle = (row[VARIANT_TITLE_COL] || '').trim();
	if (variantTitle) {
		variant.metafields = [{ namespace: 'custom', key: 'variant_title', value: variantTitle }];
	}

	const imageUrl = row['Variant Image'] || row['Image Src'];
	if (imageUrl) {
		const alt = row['Image Src'] ? productImageAlt(productTitle, row['Product Description']) : variantImageAlt(productTitle, variantTitle);
		variant.file = { originalSource: imageUrl, alt };
	}

	return variant;
}

function buildProductInput(group, ids, collectionId) {
	const parent = group.parent;
	const { optionDefs, productOptions } = buildOptions(group, ids);

	const variants = group.rows.map((row) => buildVariant(row, optionDefs, parent['Product Title']));

	// Product-level files: every distinct image referenced by any variant, deduped by URL.
	const files = [];
	const seenImages = new Set();
	for (const variant of variants) {
		if (variant.file && !seenImages.has(variant.file.originalSource)) {
			seenImages.add(variant.file.originalSource);
			files.push({ originalSource: variant.file.originalSource, alt: variant.file.alt });
		}
	}

	const input = {
		handle: parent['Handle'],
		title: parent['Product Title'],
		descriptionHtml: parent['Product Description'],
		vendor: parent['Vendor'],
		productType: parent['Product Type'],
		status: 'DRAFT',
		tags: splitList(parent['Tags']),
		category: VITAMINS_SUPPLEMENTS_CATEGORY,
		seo: { title: parent['SEO Title'], description: parent['SEO Description'] },
		collections: [collectionId],
		metafields: buildProductMetafields(parent, ids, optionDefs),
		productOptions: productOptions.length ? productOptions : [{ name: 'Title', position: 1, values: [{ name: 'Default Title' }] }],
		variants,
	};
	if (files.length) input.files = files;

	return input;
}

function parseArgs(argv) {
	const args = { dryRun: false, limit: null, handles: null, publishOnly: false };
	for (const arg of argv) {
		if (arg === '--dry-run') args.dryRun = true;
		else if (arg === '--publish-only') args.publishOnly = true;
		else if (arg.startsWith('--limit=')) args.limit = Number(arg.slice('--limit='.length));
		else if (arg.startsWith('--handles=')) args.handles = new Set(arg.slice('--handles='.length).split(',').map((s) => s.trim()));
	}
	return args;
}

/** --publish-only: publish existing products (matched by handle) to all available channels. */
async function runPublishOnly(groups, args) {
	const publicationIds = args.dryRun ? [] : await fetchPublicationIds();
	if (!publicationIds?.length) {
		console.log('No publications available — nothing to publish.');
		return;
	}

	console.log(`Publishing ${groups.length} product(s) to all channels...\n`);
	let ok = 0;
	let failed = 0;
	for (const group of groups) {
		const data = await graphql(PRODUCT_BY_HANDLE, { handle: group.handle });
		if (!data.productByHandle) {
			console.log(`  SKIP — ${group.handle}: product not found`);
			failed++;
			continue;
		}
		const errors = await publishToAllChannels(data.productByHandle.id, publicationIds);
		if (logUserErrors(group.handle, errors)) {
			console.log(`  OK — ${group.handle}`);
			ok++;
		} else {
			failed++;
		}
	}
	console.log(`\nDone. ${ok} succeeded, ${failed} failed.`);
	if (failed) process.exitCode = 1;
}

/** Build and upsert (via productSet) every product group, then publish to all channels if available. */
async function runImport(groups, args) {
	const ids = JSON.parse(await readFile(path.join(DATA_DIR, METAOBJECT_IDS_FILE), 'utf8'));
	const collectionId = await fetchSupplementsCollectionId();
	const publicationIds = args.dryRun ? null : await fetchPublicationIds();

	console.log(`Importing ${groups.length} product(s)${args.dryRun ? ' (dry run)' : ''}...\n`);

	let ok = 0;
	let failed = 0;
	for (const group of groups) {
		let input;
		try {
			input = buildProductInput(group, ids, collectionId);
		} catch (err) {
			console.log(`  FAIL — ${group.handle}: ${err.message}`);
			failed++;
			continue;
		}

		if (args.dryRun) {
			console.log(`--- ${group.handle} ---`);
			console.log(JSON.stringify(input, null, 2));
			continue;
		}

		let result = (await withRetry(() => graphql(PRODUCT_SET, { input, synchronous: true, identifier: { handle: input.handle } }))).productSet;
		if (result.userErrors.some((e) => e.code === 'CAPABILITY_VIOLATION')) {
			// Once a product has a linked metafield option (shopify.flavor / shopify.food-supplement-form),
			// productSet rejects any re-send of productOptions for that product — the option/link is
			// immutable after creation via this mutation. The product was already created correctly on
			// the initial run, so subsequent re-runs just leave it as-is.
			console.log(`  SKIP — ${group.handle}: already has linked metafield option(s); productSet can't re-apply on update, existing data left untouched`);
			ok++;
			continue;
		}
		if (!logUserErrors(group.handle, result.userErrors)) {
			failed++;
			continue;
		}

		if (publicationIds?.length) {
			const pubErrors = await publishToAllChannels(result.product.id, publicationIds);
			if (!logUserErrors(`${group.handle} publish`, pubErrors)) {
				failed++;
				continue;
			}
		}

		console.log(`  OK — ${group.handle} (${result.product.id})`);
		ok++;
	}

	console.log(`\nDone. ${ok} succeeded, ${failed} failed.`);
	if (failed) process.exitCode = 1;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));

	const text = await readFile(path.join(SHEETS_DIR, 'atx-prod-test-01_sheet_products.csv'), 'utf8');
	const rows = parseCSVObjects(text);
	let groups = groupProducts(rows);

	if (args.handles) groups = groups.filter((g) => args.handles.has(g.handle));
	if (args.limit) groups = groups.slice(0, args.limit);

	if (args.publishOnly) return runPublishOnly(groups, args);
	return runImport(groups, args);
}

main().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
