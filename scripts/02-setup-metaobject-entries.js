/**
 * Step 3-5 of the import sequence: metaobject entries.
 *
 * - Creates the 20 `supplement_category` entries (from sheets/atx-prod-test-01_sheet_supplement_categories)
 * - Creates the 13 `shopify--flavor` entries (from sheets/atx-prod-test-01_sheet_flavors), each
 *   with the required `taxonomy_reference` mapped to the closest Shopify Product Taxonomy "Flavor" value
 * - Creates the 10 `shopify--medicine-supplement-form` entries (from sheets/atx-prod-test-01_sheet_food_supplement_forms),
 *   each with the required `taxonomy_reference` mapped to the closest Shopify Product Taxonomy
 *   "Medicine/Supplement form" value
 *
 * Writes a name -> GID lookup table to scripts/data/metaobject-ids.<SHOPIFY_SHOP>.json (one file
 * per store, so dev and production runs don't clobber each other's GIDs) for use by 03-import-products.js.
 *
 * Idempotent: safe to re-run. Existing entries are matched by their name/label field value.
 */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { graphql } from '../api.js';
import { logUserErrors } from './lib/log.js';
import { parseCSVObjects } from './lib/csv.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHEETS_DIR = path.join(__dirname, '..', 'sheets');
const DATA_DIR = path.join(__dirname, 'data');
const METAOBJECT_IDS_FILE = `metaobject-ids.${process.env.SHOPIFY_SHOP}.json`;

const LIST_METAOBJECTS = `
query ListMetaobjects($type: String!, $after: String) {
  metaobjects(type: $type, first: 100, after: $after) {
    nodes { id handle fields { key value } }
    pageInfo { hasNextPage endCursor }
  }
}`;

const CREATE_METAOBJECT = `
mutation CreateMetaobject($metaobject: MetaobjectCreateInput!) {
  metaobjectCreate(metaobject: $metaobject) {
    metaobject { id type handle fields { key value } }
    userErrors { field message code }
  }
}`;

// Shopify Product Taxonomy "Flavor" attribute (gid://shopify/TaxonomyAttribute/1458) values,
// mapped from our 12 flavor names to the closest taxonomy value. Compound/unmatched flavors
// map to "Other".
const FLAVOR_TAXONOMY = {
	Unflavored: 'gid://shopify/TaxonomyValue/19290',
	'Mango Strawberry': 'gid://shopify/TaxonomyValue/19292', // Other
	Lemon: 'gid://shopify/TaxonomyValue/9042',
	Vanilla: 'gid://shopify/TaxonomyValue/19291',
	'Chocolate Banana': 'gid://shopify/TaxonomyValue/19292', // Other
	Peppermint: 'gid://shopify/TaxonomyValue/19283', // Mint
	Orange: 'gid://shopify/TaxonomyValue/19284',
	'Peach Mango': 'gid://shopify/TaxonomyValue/19292', // Other
	'Lemon Lime': 'gid://shopify/TaxonomyValue/19292', // Other
	Citrus: 'gid://shopify/TaxonomyValue/19292', // Other
	'Slightly-Seaweed': 'gid://shopify/TaxonomyValue/19292', // Other
	Cherry: 'gid://shopify/TaxonomyValue/19279',
	// Discovered in products data (optimag-neuro powder variant) but not in the 12-flavor reference sheet.
	'Mixed Berry': 'gid://shopify/TaxonomyValue/19292', // Other
};

// Shopify Product Taxonomy "Medicine/Supplement form" attribute (gid://shopify/TaxonomyAttribute/2963)
// values, mapped from our 10 form names to the closest taxonomy value. Unmatched forms map to "Other".
const FORM_TAXONOMY = {
	Capsules: 'gid://shopify/TaxonomyValue/22342',
	'Food Topper': 'gid://shopify/TaxonomyValue/22352', // Other
	Liposomal: 'gid://shopify/TaxonomyValue/22352', // Other
	Liquid: 'gid://shopify/TaxonomyValue/22346',
	Lozenges: 'gid://shopify/TaxonomyValue/10330',
	Packets: 'gid://shopify/TaxonomyValue/22352', // Other
	Powder: 'gid://shopify/TaxonomyValue/22348',
	Softgels: 'gid://shopify/TaxonomyValue/10332', // Softgel
	Spray: 'gid://shopify/TaxonomyValue/22349',
	Tablets: 'gid://shopify/TaxonomyValue/22351',
};

/** Read a single-column reference CSV and return the list of values (header row excluded). */
async function readNamesCSV(filename) {
	const text = await readFile(path.join(SHEETS_DIR, `${filename}.csv`), 'utf8');
	const rows = parseCSVObjects(text);
	const header = Object.keys(rows[0])[0];
	return rows.map((r) => r[header].trim()).filter(Boolean);
}

/** Fetch all existing metaobjects of a given type. */
async function listExisting(type) {
	const nodes = [];
	let after = null;
	for (;;) {
		const data = await graphql(LIST_METAOBJECTS, { type, after });
		nodes.push(...data.metaobjects.nodes);
		if (!data.metaobjects.pageInfo.hasNextPage) break;
		after = data.metaobjects.pageInfo.endCursor;
	}
	return nodes;
}

/** Create a metaobject entry, or return the existing one if a field with key=matchKey already matches matchValue. */
async function upsertMetaobject(type, fields, matchKey, existing) {
	const matchValue = fields.find((f) => f.key === matchKey)?.value;
	const found = existing.find((n) => n.fields.some((f) => f.key === matchKey && f.value === matchValue));
	if (found) {
		console.log(`  OK — ${type} "${matchValue}" already exists (${found.id})`);
		return found.id;
	}

	const data = await graphql(CREATE_METAOBJECT, { metaobject: { type, fields } });
	const result = data.metaobjectCreate;
	if (result.userErrors?.length) {
		logUserErrors(`${type} "${matchValue}"`, result.userErrors);
		// Possible handle/uniqueness conflict — re-fetch and try to match again.
		const refreshed = await listExisting(type);
		const refound = refreshed.find((n) => n.fields.some((f) => f.key === matchKey && f.value === matchValue));
		if (refound) return refound.id;
		throw new Error(`Failed to create or find ${type} "${matchValue}"`);
	}

	console.log(`  Created — ${type} "${matchValue}" (${result.metaobject.id})`);
	return result.metaobject.id;
}

async function main() {
	const ids = { categories: {}, flavors: {}, forms: {} };

	console.log('--- Creating supplement_category entries ---');
	const categories = await readNamesCSV('atx-prod-test-01_sheet_supplement_categories');
	const existingCategories = await listExisting('supplement_category');
	for (const name of categories) {
		ids.categories[name] = await upsertMetaobject('supplement_category', [{ key: 'name', value: name }], 'name', existingCategories);
	}

	console.log('\n--- Creating shopify--flavor entries ---');
	const flavors = await readNamesCSV('atx-prod-test-01_sheet_flavors');
	const existingFlavors = await listExisting('shopify--flavor');
	for (const name of flavors) {
		const taxonomyRef = FLAVOR_TAXONOMY[name];
		if (!taxonomyRef) throw new Error(`No taxonomy mapping for flavor "${name}"`);
		ids.flavors[name] = await upsertMetaobject(
			'shopify--flavor',
			[
				{ key: 'label', value: name },
				{ key: 'taxonomy_reference', value: taxonomyRef },
			],
			'label',
			existingFlavors,
		);
	}

	console.log('\n--- Creating shopify--medicine-supplement-form entries ---');
	const forms = await readNamesCSV('atx-prod-test-01_sheet_food_supplement_forms');
	const existingForms = await listExisting('shopify--medicine-supplement-form');
	for (const name of forms) {
		const taxonomyRef = FORM_TAXONOMY[name];
		if (!taxonomyRef) throw new Error(`No taxonomy mapping for form "${name}"`);
		ids.forms[name] = await upsertMetaobject(
			'shopify--medicine-supplement-form',
			[
				{ key: 'label', value: name },
				{ key: 'taxonomy_reference', value: taxonomyRef },
			],
			'label',
			existingForms,
		);
	}

	await mkdir(DATA_DIR, { recursive: true });
	const outputPath = path.join(DATA_DIR, METAOBJECT_IDS_FILE);
	await writeFile(outputPath, JSON.stringify(ids, null, 2));
	console.log(`\nWrote ${outputPath}`);
	console.log('Done.');
}

main().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
