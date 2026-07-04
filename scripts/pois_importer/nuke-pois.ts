import axios from 'axios';
import dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env
dotenv.config({ path: path.resolve(__dirname, '../../.env') }); // Root
dotenv.config({ path: path.resolve(__dirname, '.env') });       // Local

const STRAPI_BASE_URL = process.env.STRAPI_BASE_URL || 'http://localhost:1337';
const STRAPI_API_TOKEN = process.env.STRAPI_API_TOKEN;

async function nukeCollection(collection: string) {
  console.log(`\n💥 Nuking collection: ${collection.toUpperCase()}...`);
  
  const client = axios.create({
    baseURL: STRAPI_BASE_URL,
    headers: { Authorization: `Bearer ${STRAPI_API_TOKEN}` }
  });

  let totalDeleted = 0;

  while (true) {
    // Get a batch of items
    // We use fields[0]=id to be light
    const res = await client.get(`/api/${collection}`, {
      params: {
        'pagination[pageSize]': 100,
        'fields[0]': 'documentId', // v5 uses documentId for delete
        'fields[1]': 'id'          // fallback
      }
    });

    const items = res.data.data;
    if (items.length === 0) break;

    console.log(`   Found batch of ${items.length} items to delete...`);

    // Delete them one by one (Strapi doesn't have bulk delete endpoint by default)
    // We use Promise.all for speed. On compte les suppressions RÉELLEMENT réussies.
    let deletedThisPass = 0;
    await Promise.all(items.map(async (item: any) => {
      const idToDelete = item.documentId || item.id;
      try {
        await client.delete(`/api/${collection}/${idToDelete}`);
        deletedThisPass++;
        process.stdout.write('x');
      } catch (e: any) {
        process.stdout.write('E');
      }
    }));
    console.log(''); // New line
    totalDeleted += deletedThisPass;

    // Aucune suppression réussie alors qu'il reste des items (token en lecture seule ?) → on
    // arrête pour éviter une boucle infinie qui martèlerait l'API indéfiniment.
    if (deletedThisPass === 0) {
      console.error(`⚠️  Aucun item supprimé sur ce lot (${items.length} restants). Token en lecture seule ou permissions manquantes ? Arrêt.`);
      break;
    }
  }

  console.log(`✅ Deleted ${totalDeleted} items from ${collection}.`);
}

async function main() {
  console.log('☢️  NUKE POIS & MUSEUMS SCRIPT ☢️');
  if (!STRAPI_API_TOKEN) {
    console.error('❌ STRAPI_API_TOKEN manquant — sans token en écriture, les suppressions échoueront. Abandon.');
    process.exit(1);
  }
  console.log('This will DELETE ALL data in "museums" and "pois".');
  console.log('Waiting 3 seconds before start... (Ctrl+C to cancel)');
  
  await new Promise(resolve => setTimeout(resolve, 3000));

  try {
    await nukeCollection('museums');
    await nukeCollection('pois');
    console.log('\n✨ All clean! You can now run the import script.');
  } catch (e: any) {
    console.error('Error:', e.message);
  }
}

main();