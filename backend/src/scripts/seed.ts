import bcrypt from 'bcryptjs';
import { env } from '../config/env';
import { connectDB, disconnectDB } from '../db/connect';
import { DEFAULT_ROLES } from '../permissions';
import { Category, Product, Role, Store, User } from '../models';

// npm run db:seed  (safe to run more than once)
//  1. built-in roles
//  2. the first Super Admin (needs SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD in .env)
//  3. optional demo store "kababjess" when SEED_SAMPLE_STORE=true

async function seedRoles() {
  for (const r of DEFAULT_ROLES) {
    await Role.updateOne(
      { storeId: null, key: r.key },
      { $set: { name: r.name, scope: r.scope, permissions: r.permissions, builtIn: true } },
      { upsert: true },
    );
  }
  console.log(`roles: ${DEFAULT_ROLES.length} built-in roles ready`);
}

async function seedSuperAdmin() {
  const email = env.superAdminEmail.toLowerCase();
  if (!email || !env.superAdminPassword) {
    console.log('super admin: skipped (set SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD in backend/.env)');
    return;
  }
  if (env.superAdminPassword.length < 12) {
    throw new Error('SUPER_ADMIN_PASSWORD must be at least 12 characters.');
  }
  const existing = await User.findOne({ email });
  if (existing) {
    console.log(`super admin: ${email} already exists, left unchanged`);
    return;
  }
  const passwordHash = await bcrypt.hash(env.superAdminPassword, 12);
  await User.create({ name: 'Super Admin', email, passwordHash, isSuperAdmin: true });
  console.log(`super admin: created ${email}`);
}

async function seedSampleStore() {
  if (!env.seedSampleStore) {
    console.log('sample store: skipped (SEED_SAMPLE_STORE is not true)');
    return;
  }
  const store = await Store.findOneAndUpdate(
    { subdomain: 'kababjess' },
    { $setOnInsert: { name: 'Kabab Jess', subdomain: 'kababjess', type: 'native', platform: 'native', currency: 'PKR' } },
    { upsert: true, returnDocument: 'after' },
  );
  const storeId = store!._id;

  const category = await Category.findOneAndUpdate(
    { storeId, slug: 'frozen-food' },
    { $setOnInsert: { name: 'Frozen food', active: true } },
    { upsert: true, returnDocument: 'after' },
  );

  await Product.updateOne(
    { storeId, slug: 'chicken-seekh-kabab-500g' },
    {
      $setOnInsert: {
        categoryId: category!._id,
        type: 'physical',
        name: 'Chicken seekh kabab 500 g',
        status: 'active',
        variants: [{ sku: 'KJ-SEEKH-500', price: 85000, stock: 100 }], // Rs 850.00 in paisa
      },
    },
    { upsert: true },
  );
  await Product.updateOne(
    { storeId, slug: 'recipe-ebook' },
    {
      $setOnInsert: {
        type: 'digital',
        name: 'Kabab recipe e-book',
        status: 'active',
        variants: [{ sku: 'KJ-EBOOK', price: 50000 }],
        digitalFiles: [{ name: 'kabab-recipes.pdf', storageKey: 'digital/kababjess/kabab-recipes.pdf' }],
      },
    },
    { upsert: true },
  );
  console.log(`sample store: kababjess.${env.platformDomain} with 1 category, 1 physical and 1 digital product`);
}

async function main() {
  await connectDB();
  await seedRoles();
  await seedSuperAdmin();
  await seedSampleStore();
}

main()
  .catch((err: Error) => {
    console.error('Seed failed:', err.message.replace(/\/\/[^@\s]*@/g, '//***@'));
    process.exitCode = 1;
  })
  .finally(disconnectDB);
