import { graphql } from '../api.js';

const ZIP_URL = 'https://raw.githubusercontent.com/LaneMelancon/ns-atx-supplement-store/main/theme-tinker.zip';
const THEME_NAME = 'NeuroSolution Tinker';

async function run() {
  console.log(`Creating theme "${THEME_NAME}" from ${ZIP_URL}...`);

  const data = await graphql(`
    mutation createTheme($source: URL!, $name: String!, $role: ThemeRole!) {
      themeCreate(source: $source, name: $name, role: $role) {
        theme { id name role }
        userErrors { field message }
      }
    }
  `, {
    source: ZIP_URL,
    name: THEME_NAME,
    role: 'UNPUBLISHED'
  });

  const result = data.themeCreate;
  if (result.userErrors?.length) {
    console.error('Errors:', result.userErrors);
    process.exit(1);
  }

  console.log(`Theme created: ${result.theme.id}`);
  console.log(`Name: ${result.theme.name}`);
  console.log(`Role: ${result.theme.role}`);
  console.log(`\nPreview at: https://${process.env.SHOPIFY_SHOP}.myshopify.com/admin/themes`);
}

run().catch(err => { console.error(err); process.exit(1); });
