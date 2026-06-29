/**
 * Step 1 of the import sequence: metaobject + metafield definitions.
 *
 * - Enables native `shopify--flavor` and `shopify--medicine-supplement-form` metaobject definitions
 * - Creates the custom `supplement_category` metaobject definition
 * - Enables native `shopify.flavor` and `shopify.food-supplement-form` metafield definitions (linked to variant options),
 *   then pins their Category Assignment to Vitamins & Supplements via constraintsUpdates
 * - Creates custom product metafield definitions (product_details, supplement_ingredients, supplement_size, supplement_category),
 *   with supplement_ingredients/supplement_size/supplement_category pinned to Vitamins & Supplements via constraints
 * - Creates the variant_title metafield definition
 * - Pins product_details so it appears first in the product metafields list
 *
 * Idempotent: safe to re-run. Existing definitions are looked up and, if their name has
 * drifted from the desired sentence-case form below, renamed in place.
 */
import { graphql } from '../api.js';
import { logUserErrors } from './lib/log.js';

const ENABLE_METAOBJECT = `
mutation EnableStandardMetaobject($type: String!) {
  standardMetaobjectDefinitionEnable(type: $type) {
    metaobjectDefinition { id type name }
    userErrors { field message code }
  }
}`;

const GET_METAOBJECT_DEF_BY_TYPE = `
query GetMetaobjectDefByType($type: String!) {
  metaobjectDefinitionByType(type: $type) { id type }
}`;

const CREATE_METAOBJECT_DEF = `
mutation CreateMetaobjectDefinition($definition: MetaobjectDefinitionCreateInput!) {
  metaobjectDefinitionCreate(definition: $definition) {
    metaobjectDefinition { id type name fieldDefinitions { key name } }
    userErrors { field message code }
  }
}`;

const UPDATE_METAOBJECT_DEF = `
mutation UpdateMetaobjectDefinition($id: ID!, $definition: MetaobjectDefinitionUpdateInput!) {
  metaobjectDefinitionUpdate(id: $id, definition: $definition) {
    metaobjectDefinition { id }
    userErrors { field message code }
  }
}`;

const ENABLE_STANDARD_METAFIELD = `
mutation EnableStandardMetafield($ownerType: MetafieldOwnerType!, $namespace: String!, $key: String!, $capabilities: MetafieldCapabilityCreateInput) {
  standardMetafieldDefinitionEnable(ownerType: $ownerType, namespace: $namespace, key: $key, capabilities: $capabilities) {
    createdDefinition { id name namespace key }
    userErrors { field message code }
  }
}`;

const CREATE_METAFIELD_DEF = `
mutation CreateMetafieldDefinition($definition: MetafieldDefinitionInput!) {
  metafieldDefinitionCreate(definition: $definition) {
    createdDefinition { id name namespace key }
    userErrors { field message code }
  }
}`;

const UPDATE_METAFIELD_DEF_NAME = `
mutation UpdateMetafieldDefinitionName($namespace: String, $key: String!, $ownerType: MetafieldOwnerType!, $name: String!) {
  metafieldDefinitionUpdate(definition: { namespace: $namespace, key: $key, ownerType: $ownerType, name: $name }) {
    updatedDefinition { id }
    userErrors { field message code }
  }
}`;

const GET_METAFIELD_DEF = `
query GetMetafieldDefinition($identifier: MetafieldDefinitionIdentifierInput!) {
  metafieldDefinition(identifier: $identifier) {
    id
    constraints {
      key
      values(first: 250) { nodes { value } }
    }
  }
}`;

const UPDATE_METAFIELD_DEF_CONSTRAINTS = `
mutation UpdateMetafieldDefinitionConstraints($namespace: String, $key: String!, $ownerType: MetafieldOwnerType!, $constraintsUpdates: MetafieldDefinitionConstraintsUpdatesInput!) {
  metafieldDefinitionUpdate(definition: { namespace: $namespace, key: $key, ownerType: $ownerType, constraintsUpdates: $constraintsUpdates }) {
    updatedDefinition { id }
    userErrors { field message code }
  }
}`;

const PIN_METAFIELD_DEF = `
mutation PinMetafieldDefinition($identifier: MetafieldDefinitionIdentifierInput!) {
  metafieldDefinitionPin(identifier: $identifier) {
    pinnedDefinition { id pinnedPosition }
    userErrors { field message code }
  }
}`;

const FILTER_CAPABILITIES = {
	adminFilterable: { enabled: true },
	smartCollectionCondition: { enabled: true },
};

const VITAMINS_SUPPLEMENTS_CATEGORY = 'gid://shopify/TaxonomyCategory/hb-1-9-6';
const VITAMINS_SUPPLEMENTS_CATEGORY_ID = VITAMINS_SUPPLEMENTS_CATEGORY.split('/').pop();

const VITAMINS_SUPPLEMENTS_CONSTRAINT = {
	key: 'category',
	values: [VITAMINS_SUPPLEMENTS_CATEGORY],
};

/** True if a userErrors array contains a "TAKEN" (already exists) error. */
function isTaken(userErrors) {
	return userErrors?.some((e) => e.code === 'TAKEN') ?? false;
}

/** Enable a native metaobject definition (flavor / medicine-supplement-form). Names are Shopify-managed. */
async function enableStandardMetaobject(type) {
	const data = await graphql(ENABLE_METAOBJECT, { type });
	const result = data.standardMetaobjectDefinitionEnable;
	if (isTaken(result.userErrors)) {
		const existing = await graphql(GET_METAOBJECT_DEF_BY_TYPE, { type });
		console.log(`  OK — ${type} already enabled (id=${existing.metaobjectDefinitionByType.id})`);
		return existing.metaobjectDefinitionByType.id;
	}
	logUserErrors(type, result.userErrors);
	console.log(`  Created — ${type} (id=${result.metaobjectDefinition.id})`);
	return result.metaobjectDefinition.id;
}

/** Create a custom metaobject definition, or rename the existing one to match `definition.name`. */
async function upsertMetaobjectDefinition(definition, label) {
	const data = await graphql(CREATE_METAOBJECT_DEF, { definition });
	const result = data.metaobjectDefinitionCreate;
	if (isTaken(result.userErrors)) {
		const existing = await graphql(GET_METAOBJECT_DEF_BY_TYPE, { type: definition.type });
		const id = existing.metaobjectDefinitionByType.id;
		const renamed = await graphql(UPDATE_METAOBJECT_DEF, { id, definition: { name: definition.name } });
		logUserErrors(`${label} rename`, renamed.metaobjectDefinitionUpdate.userErrors);
		console.log(`  OK — ${label} already exists (id=${id})`);
		return id;
	}
	logUserErrors(label, result.userErrors);
	console.log(`  Created — ${label} (id=${result.metaobjectDefinition.id})`);
	return result.metaobjectDefinition.id;
}

/** Enable a native product metafield definition (shopify.flavor / shopify.food-supplement-form). Names are Shopify-managed. */
async function enableStandardMetafield(namespace, key) {
	const data = await graphql(ENABLE_STANDARD_METAFIELD, {
		ownerType: 'PRODUCT',
		namespace,
		key,
		capabilities: FILTER_CAPABILITIES,
	});
	const result = data.standardMetafieldDefinitionEnable;
	if (isTaken(result.userErrors)) {
		console.log(`  OK — ${namespace}.${key} metafield definition already enabled`);
		return;
	}
	logUserErrors(`${namespace}.${key} metafield definition`, result.userErrors);
}

/** Create a custom metafield definition, or rename the existing one to match `definition.name`. */
async function upsertMetafieldDefinition(definition, label) {
	const data = await graphql(CREATE_METAFIELD_DEF, { definition });
	const result = data.metafieldDefinitionCreate;
	if (isTaken(result.userErrors)) {
		const renamed = await graphql(UPDATE_METAFIELD_DEF_NAME, {
			namespace: definition.namespace,
			key: definition.key,
			ownerType: definition.ownerType,
			name: definition.name,
		});
		logUserErrors(`${label} rename`, renamed.metafieldDefinitionUpdate.userErrors);
		console.log(`  OK — ${label} already exists`);
		return;
	}
	logUserErrors(label, result.userErrors);
	console.log(`  Created — ${label}`);
}

/**
 * Ensure a metafield definition's Category Assignment is pinned to Vitamins & Supplements.
 * Used for native definitions (shopify.flavor / shopify.food-supplement-form) enabled via
 * standardMetafieldDefinitionEnable, which doesn't accept a `constraints` input directly.
 */
async function ensureCategoryConstraint(namespace, key, label) {
	const data = await graphql(GET_METAFIELD_DEF, {
		identifier: { ownerType: 'PRODUCT', namespace, key },
	});
	const def = data.metafieldDefinition;
	if (!def) {
		console.log(`  WARN — ${label}: definition not found, skipping category constraint`);
		return;
	}
	const values = def.constraints?.values?.nodes ?? [];
	const alreadySet = def.constraints?.key === 'category' && values.some((v) => v.value === VITAMINS_SUPPLEMENTS_CATEGORY_ID);
	if (alreadySet) {
		console.log(`  OK — ${label} already constrained to Vitamins & Supplements`);
		return;
	}
	const result = await graphql(UPDATE_METAFIELD_DEF_CONSTRAINTS, {
		namespace,
		key,
		ownerType: 'PRODUCT',
		constraintsUpdates: { key: 'category', values: [{ create: VITAMINS_SUPPLEMENTS_CATEGORY }] },
	});
	logUserErrors(`${label} category constraint`, result.metafieldDefinitionUpdate.userErrors);
	if (!result.metafieldDefinitionUpdate.userErrors.length) {
		console.log(`  OK — ${label} constrained to Vitamins & Supplements`);
	}
}

/** Pin a metafield definition so it's shown at the top of its owner's metafield list. */
async function pinMetafieldDefinition(namespace, key, ownerType, label) {
	const data = await graphql(PIN_METAFIELD_DEF, { identifier: { namespace, key, ownerType } });
	const result = data.metafieldDefinitionPin;
	if (!logUserErrors(`${label} pin`, result.userErrors)) return;
	const position = result.pinnedDefinition.pinnedPosition;
	console.log(`  OK — ${label} pinned (position ${position})`);
}

async function main() {
	console.log('--- Enabling native metaobject definitions ---');
	await enableStandardMetaobject('shopify--flavor');
	await enableStandardMetaobject('shopify--medicine-supplement-form');

	console.log('\n--- Creating custom metaobject definitions ---');
	const supplementCategoryDefId = await upsertMetaobjectDefinition(
		{
			name: 'Supplement category',
			type: 'supplement_category',
			fieldDefinitions: [
				{ name: 'Name', key: 'name', type: 'single_line_text_field' },
				{ name: 'Description', key: 'description', type: 'multi_line_text_field' },
				{ name: 'Icon', key: 'icon', type: 'file_reference' },
				{ name: 'Image', key: 'image', type: 'file_reference' },
			],
		},
		'supplement_category',
	);

	console.log('\n--- Enabling native metafield definitions ---');
	await enableStandardMetafield('shopify', 'flavor');
	await enableStandardMetafield('shopify', 'food-supplement-form');

	console.log('\n--- Pinning native metafield definitions to Vitamins & Supplements ---');
	await ensureCategoryConstraint('shopify', 'flavor', 'shopify.flavor');
	await ensureCategoryConstraint('shopify', 'food-supplement-form', 'shopify.food-supplement-form');

	console.log('\n--- Creating custom product metafield definitions ---');
	await upsertMetafieldDefinition(
		{
			name: 'Product details',
			namespace: 'custom',
			key: 'product_details',
			ownerType: 'PRODUCT',
			type: 'rich_text_field',
		},
		'custom.product_details',
	);
	await upsertMetafieldDefinition(
		{
			name: 'Supplement ingredients',
			namespace: 'custom',
			key: 'supplement_ingredients',
			ownerType: 'PRODUCT',
			type: 'rich_text_field',
			constraints: VITAMINS_SUPPLEMENTS_CONSTRAINT,
		},
		'custom.supplement_ingredients',
	);
	await upsertMetafieldDefinition(
		{
			name: 'Supplement size',
			namespace: 'custom',
			key: 'supplement_size',
			ownerType: 'PRODUCT',
			type: 'list.single_line_text_field',
			constraints: VITAMINS_SUPPLEMENTS_CONSTRAINT,
		},
		'custom.supplement_size',
	);
	await upsertMetafieldDefinition(
		{
			name: 'Supplement category',
			namespace: 'custom',
			key: 'supplement_category',
			ownerType: 'PRODUCT',
			type: 'list.metaobject_reference',
			validations: [
				{ name: 'metaobject_definition_id', value: supplementCategoryDefId },
				{ name: 'list.min', value: '1' },
			],
			capabilities: FILTER_CAPABILITIES,
			constraints: VITAMINS_SUPPLEMENTS_CONSTRAINT,
		},
		'custom.supplement_category',
	);

	console.log('\n--- Creating variant metafield definition ---');
	await upsertMetafieldDefinition(
		{
			name: 'Variant title',
			namespace: 'custom',
			key: 'variant_title',
			ownerType: 'PRODUCTVARIANT',
			type: 'single_line_text_field',
			capabilities: { smartCollectionCondition: { enabled: true } },
		},
		'custom.variant_title (variant)',
	);

	console.log('\n--- Pinning product details to the top of the product metafields list ---');
	await pinMetafieldDefinition('custom', 'product_details', 'PRODUCT', 'custom.product_details');

	console.log('\nDone.');
}

main().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});
