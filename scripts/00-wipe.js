/**
 * Wipe the dev store back to empty: all products, the custom/native metaobject
 * definitions (which cascade-delete their entries and linked metafield definitions),
 * and the remaining standalone custom metafield definitions.
 *
 * Usage:
 *   node --env-file=.env scripts/00-wipe.js
 */
import { graphql } from '../api.js';
import { withRetry } from './lib/throttle.js';

const PRODUCT_DELETE = `
mutation ProductDelete($input: ProductDeleteInput!) {
  productDelete(input: $input) {
    deletedProductId
    userErrors { field message }
  }
}`;

const METAOBJECT_DEFINITION_DELETE = `
mutation MetaobjectDefinitionDelete($id: ID!) {
  metaobjectDefinitionDelete(id: $id) {
    deletedId
    userErrors { field message code }
  }
}`;

const METAFIELD_DEFINITION_DELETE = `
mutation MetafieldDefinitionDelete($id: ID!, $deleteAllAssociatedMetafields: Boolean!) {
  metafieldDefinitionDelete(id: $id, deleteAllAssociatedMetafields: $deleteAllAssociatedMetafields) {
    deletedDefinitionId
    userErrors { field message code }
  }
}`;

async function listProductIds() {
	const ids = [];
	let cursor = null;
	for (;;) {
		const data = await graphql(
			`query($cursor: String) { products(first: 100, after: $cursor) { nodes { id } pageInfo { hasNextPage endCursor } } }`,
			{ cursor },
		);
		ids.push(...data.products.nodes.map((n) => n.id));
		if (!data.products.pageInfo.hasNextPage) break;
		cursor = data.products.pageInfo.endCursor;
	}
	return ids;
}

async function main() {
	const productIds = await listProductIds();
	console.log(`Deleting ${productIds.length} product(s)...`);
	for (const id of productIds) {
		const data = await withRetry(() => graphql(PRODUCT_DELETE, { input: { id } }));
		const errs = data.productDelete.userErrors;
		console.log(errs.length ? `  FAIL ${id}: ${errs.map((e) => e.message).join('; ')}` : `  deleted ${id}`);
	}

	const metaobjectTypes = ['supplement_category', 'shopify--flavor', 'shopify--medicine-supplement-form'];
	for (const type of metaobjectTypes) {
		const data = await graphql(`query($type: String!) { metaobjectDefinitionByType(type: $type) { id } }`, { type });
		const id = data.metaobjectDefinitionByType?.id;
		if (!id) {
			console.log(`  skip ${type} (not found)`);
			continue;
		}
		const del = await withRetry(() => graphql(METAOBJECT_DEFINITION_DELETE, { id }));
		const errs = del.metaobjectDefinitionDelete.userErrors;
		console.log(errs.length ? `  FAIL ${type}: ${errs.map((e) => e.message).join('; ')}` : `  deleted metaobject definition ${type} (${id})`);
	}

	const metafieldDefs = [
		{ namespace: 'custom', key: 'product_details', ownerType: 'PRODUCT' },
		{ namespace: 'custom', key: 'supplement_ingredients', ownerType: 'PRODUCT' },
		{ namespace: 'custom', key: 'supplement_size', ownerType: 'PRODUCT' },
		{ namespace: 'custom', key: 'variant_title', ownerType: 'PRODUCTVARIANT' },
	];
	for (const { namespace, key, ownerType } of metafieldDefs) {
		const data = await graphql(
			`query($ownerType: MetafieldOwnerType!, $namespace: String!, $key: String!) { metafieldDefinitions(first: 1, ownerType: $ownerType, namespace: $namespace, key: $key) { nodes { id } } }`,
			{ ownerType, namespace, key },
		);
		const id = data.metafieldDefinitions.nodes[0]?.id;
		if (!id) {
			console.log(`  skip ${namespace}.${key} (not found)`);
			continue;
		}
		const del = await withRetry(() => graphql(METAFIELD_DEFINITION_DELETE, { id, deleteAllAssociatedMetafields: true }));
		const errs = del.metafieldDefinitionDelete.userErrors;
		console.log(errs.length ? `  FAIL ${namespace}.${key}: ${errs.map((e) => e.message).join('; ')}` : `  deleted metafield definition ${namespace}.${key} (${id})`);
	}

	console.log('\nDone.');
}

main().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
