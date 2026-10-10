// =====================================================================
// Database seed (Phase 2)
// Run with:  npm run db:seed
//
// Safe to run more than once: every record is "upserted" (created if
// missing, left alone if it already exists), so you never get duplicates.
// DEVELOPMENT DATA ONLY: change the admin password before any real use.
// =====================================================================
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// ---------- Sample data (all inventory quantities are in GRAMS) ----------

const CATEGORIES = ["Starters", "Mains", "Drinks", "Desserts"];

// [name, startingStockGrams, reorderLevelGrams]
const INGREDIENTS = [
  ["Rice", 50000, 10000],
  ["Chicken", 30000, 8000],
  ["Beef", 20000, 5000],
  ["Tomato", 15000, 4000],
  ["Onion", 10000, 3000],
  ["Cooking Oil", 20000, 5000],
  ["Flour", 25000, 6000],
  ["Sugar", 10000, 3000],
  ["Orange", 20000, 5000],
  ["Cocoa", 5000, 1000],
];

// name, description, price, category, available recipe (ingredient -> grams per portion)
const MENU = [
  {
    name: "Chicken Wings",
    description: "Crispy fried wings",
    price: 3500,
    category: "Starters",
    recipe: { Chicken: 250, "Cooking Oil": 30, Flour: 20 },
  },
  {
    name: "Tomato Soup",
    description: "Creamy tomato soup",
    price: 2500,
    category: "Starters",
    recipe: { Tomato: 300, Onion: 50, "Cooking Oil": 15 },
  },
  {
    name: "Chicken Fried Rice",
    description: "Fried rice with chicken",
    price: 5500,
    category: "Mains",
    recipe: { Rice: 250, Chicken: 150, Onion: 40, "Cooking Oil": 25 },
  },
  {
    name: "Beef Burger",
    description: "Grilled beef patty burger",
    price: 6000,
    category: "Mains",
    recipe: { Beef: 200, Flour: 80, Onion: 30, Tomato: 40 },
  },
  {
    name: "Fresh Orange Juice",
    description: "Freshly squeezed",
    price: 2000,
    category: "Drinks",
    recipe: { Orange: 400, Sugar: 10 },
  },
  {
    name: "Chocolate Cake",
    description: "Rich chocolate slice",
    price: 3000,
    category: "Desserts",
    recipe: { Flour: 100, Sugar: 60, Cocoa: 30 },
  },
];

// [tableNumber, capacity]
const TABLES = [
  [1, 2],
  [2, 2],
  [3, 4],
  [4, 4],
  [5, 4],
  [6, 6],
  [7, 6],
  [8, 8],
];

async function main() {
  // 1. Admin user. The password comes from .env if set, otherwise a dev default.
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@restaurant.local";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "Admin@12345";
  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {}, // never overwrite an existing admin
    create: {
      email: adminEmail,
      name: "Restaurant Admin",
      passwordHash: await bcrypt.hash(adminPassword, 10),
      role: "ADMIN",
    },
  });

  // 2. Categories (name is unique, so it works as the upsert key)
  const categoryIds = {};
  for (const name of CATEGORIES) {
    const category = await prisma.category.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    categoryIds[name] = category.id;
  }

  // 3. Inventory
  const inventoryIds = {};
  for (const [name, quantityGrams, reorderLevel] of INGREDIENTS) {
    const item = await prisma.inventoryItem.upsert({
      where: { name },
      update: {}, // keep current stock if it already exists
      create: { name, quantityGrams, reorderLevel },
    });
    inventoryIds[name] = item.id;
  }

  // 4. Menu items + recipes
  // MenuItem.name is not unique (soft-deleted items may share a name),
  // so look it up first instead of using upsert.
  for (const entry of MENU) {
    let menuItem = await prisma.menuItem.findFirst({
      where: { name: entry.name, isDeleted: false },
    });
    if (!menuItem) {
      menuItem = await prisma.menuItem.create({
        data: {
          name: entry.name,
          description: entry.description,
          price: entry.price,
          categoryId: categoryIds[entry.category],
        },
      });
    }

    // Recipe rows use a composite key (menuItemId + inventoryItemId)
    for (const [ingredient, gramsUsed] of Object.entries(entry.recipe)) {
      await prisma.recipeItem.upsert({
        where: {
          menuItemId_inventoryItemId: {
            menuItemId: menuItem.id,
            inventoryItemId: inventoryIds[ingredient],
          },
        },
        update: {},
        create: {
          menuItemId: menuItem.id,
          inventoryItemId: inventoryIds[ingredient],
          gramsUsed,
        },
      });
    }
  }

  // 5. Tables (number is unique)
  for (const [number, capacity] of TABLES) {
    await prisma.table.upsert({
      where: { number },
      update: {},
      create: { number, capacity },
    });
  }

  console.log("Seed complete.");
  console.log(`Admin login -> ${adminEmail} / ${adminPassword}`);
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
