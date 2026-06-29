/**
 * Step 7 (optional): post-import verification.
 *
 * Read-only checks against the live store:
 *   - product count matches the number of product groups in the source CSV
 *   - every product is in DRAFT status
 *   - image/variant media has finished processing (reports FAILED media with the reason)
 *   - the linked-metafield-option products (resvero-active, gut-feeling, immunog-prp,
 *     optimag-neuro) still have shopify.flavor / shopify.food-supplement-form linked options
 *
 * Usage:
 *   node --env-file=.env scripts/04-verify.js
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { graphql } from '../api.js';
import { parseCSVObjects } from './lib/csv.js';
import { groupProducts } from './lib/products.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHEETS_DIR = path.join(__dirname, '..', 'sheets');

// Products whose Formula option is linked to a shopify.flavor / shopify.food-supplement-form metafield.
const LINKED_OPTION_HANDLES = ['resvero-active', 'gut-feeling', 'immunog-prp', 'optimag-neuro'];

const PRODUCTS_QUERY = `
query Products($cursor: String) {
  products(first: 50, after: $cursor) {
    nodes {
      handle
      status
      media(first: 5) { nodes { status mediaErrors { details } } }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

const LINKED_OPTIONS_QUERY = `
query LinkedOptions($handle: String!) {
  productByHandle(handle: $handle) {
    options { name linkedMetafield { namespace key } }
  }
}`;

/** Fetch every product's handle, status, and media health. */
async function fetchAllProducts() {
	const products = [];
	let cursor = null;
	for (;;) {
		const data = await graphql(PRODUCTS_QUERY, { cursor });
		products.push(...data.products.nodes);
		if (!data.products.pageInfo.hasNextPage) break;
		cursor = data.products.pageInfo.endCursor;
	}
	return products;
}

function reportProductCount(products, expectedCount) {
	console.log('--- Product count ---');
	const match = products.length === expectedCount;
	console.log(`  expected ${expectedCount}, found ${products.length}${match ? ' — OK' : ' — MISMATCH'}`);
}

function reportStatus(products) {
	console.log('\n--- Status ---');
	const notDraft = products.filter((p) => p.status !== 'DRAFT');
	if (notDraft.length === 0) {
		console.log('  all products are DRAFT — OK');
	} else {
		for (const p of notDraft) console.log(`  NOT DRAFT — ${p.handle} (${p.status})`);
	}
}

function reportMedia(products) {
	console.log('\n--- Image media ---');
	let ready = 0;
	let failed = 0;
	let none = 0;
	const failures = [];
	for (const p of products) {
		if (p.media.nodes.length === 0) {
			none++;
			continue;
		}
		for (const m of p.media.nodes) {
			if (m.status === 'READY') {
				ready++;
			} else {
				failed++;
				const reason = m.mediaErrors?.[0]?.details ?? m.status;
				failures.push(`${p.handle}: ${reason}`);
			}
		}
	}
	console.log(`  ${ready} ready, ${failed} failed, ${none} with no media`);
	for (const f of failures) console.log(`  FAILED — ${f}`);
}

async function reportLinkedOptions() {
	console.log('\n--- Linked metafield options ---');
	for (const handle of LINKED_OPTION_HANDLES) {
		const data = await graphql(LINKED_OPTIONS_QUERY, { handle });
		const product = data.productByHandle;
		if (!product) {
			console.log(`  MISSING — ${handle}`);
			continue;
		}
		const linked = product.options
			.filter((o) => o.linkedMetafield)
			.map((o) => `${o.name} -> ${o.linkedMetafield.namespace}.${o.linkedMetafield.key}`);
		console.log(`  ${handle}: ${linked.length ? linked.join(', ') : 'NO LINKED OPTIONS'}`);
	}
}

async function main() {
	const text = await readFile(path.join(SHEETS_DIR, 'atx-prod-test-01_sheet_products.csv'), 'utf8');
	const expectedCount = groupProducts(parseCSVObjects(text)).length;

	const products = await fetchAllProducts();

	reportProductCount(products, expectedCount);
	reportStatus(products);
	reportMedia(products);
	await reportLinkedOptions();
}

main().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
