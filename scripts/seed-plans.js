/**
 * Script to seed subscription plans
 * Run with: node scripts/seed-plans.js
 * 
 * Modelo de Monetização para Professores Pequenos:
 * 
 * CRIADORES (Professores):
 * - Gratuito: 1 curso, 10 vídeos, sem quizzes IA, 25% taxa
 * - Básico (R$29/mês): 5 cursos, 50 vídeos, 5 quizzes/mês, 15% taxa
 * - Pro (R$69/mês): Ilimitado, 8% taxa, certificados
 * 
 * ESTUDANTES:
 * - Gratuito: 5 perguntas IA/dia, compra cursos individuais
 * - Família (R$29/mês): Ilimitado, acesso a todos os cursos
 */

const { Pool } = require('pg');

const plans = [
  // Creator Plans
  {
    name: 'creator_free',
    display_name: 'Gratuito',
    type: 'creator',
    price: '0.00',
    billing_period: 'monthly',
    stripe_price_id: null,
    features: JSON.stringify({
      courses: 1,
      videos: 10,
      quizzes_per_month: 0,
      commission_rate: 0.25,
      ai_questions_per_day: 0,
      support: 'community'
    }),
    is_active: 1
  },
  {
    name: 'creator_basic',
    display_name: 'Básico',
    type: 'creator',
    price: '29.00',
    billing_period: 'monthly',
    stripe_price_id: null, // Will be set after creating in Stripe
    features: JSON.stringify({
      courses: 5,
      videos: 50,
      quizzes_per_month: 5,
      commission_rate: 0.15,
      ai_questions_per_day: 10,
      support: 'email'
    }),
    is_active: 1
  },
  {
    name: 'creator_pro',
    display_name: 'Profissional',
    type: 'creator',
    price: '69.00',
    billing_period: 'monthly',
    stripe_price_id: null, // Will be set after creating in Stripe
    features: JSON.stringify({
      courses: -1,
      videos: -1,
      quizzes_per_month: -1,
      commission_rate: 0.08,
      ai_questions_per_day: -1,
      support: 'priority',
      certificates: true
    }),
    is_active: 1
  },
  // Student Plans
  {
    name: 'student_free',
    display_name: 'Gratuito',
    type: 'student',
    price: '0.00',
    billing_period: 'monthly',
    stripe_price_id: null,
    features: JSON.stringify({
      courses: 0,
      videos: 0,
      quizzes_per_month: 0,
      commission_rate: 0,
      ai_questions_per_day: 5,
      support: 'community',
      courses_access: 'purchased'
    }),
    is_active: 1
  },
  {
    name: 'student_family',
    display_name: 'Família',
    type: 'student',
    price: '29.00',
    billing_period: 'monthly',
    stripe_price_id: null, // Will be set after creating in Stripe
    features: JSON.stringify({
      courses: 0,
      videos: 0,
      quizzes_per_month: 0,
      commission_rate: 0,
      ai_questions_per_day: -1,
      support: 'email',
      courses_access: 'all',
      progress_reports: true
    }),
    is_active: 1
  }
];

async function seedPlans() {
  const databaseUrl = process.env.DATABASE_URL;
  
  if (!databaseUrl) {
    console.error('❌ DATABASE_URL not found');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    console.log('🔄 Seeding subscription plans...\n');

    for (const plan of plans) {
      // Check if plan already exists
      const existing = await pool.query(
        'SELECT id FROM subscription_plans WHERE name = $1',
        [plan.name]
      );

      if (existing.rows.length > 0) {
        console.log(`⏭️  Plan "${plan.name}" already exists, updating...`);
        await pool.query(
          `UPDATE subscription_plans 
           SET display_name = $1, type = $2, price = $3, billing_period = $4, 
               stripe_price_id = $5, features = $6, is_active = $7, updated_at = NOW()
           WHERE name = $8`,
          [plan.display_name, plan.type, plan.price, plan.billing_period, 
           plan.stripe_price_id, plan.features, plan.is_active, plan.name]
        );
      } else {
        console.log(`✅ Creating plan "${plan.name}"...`);
        await pool.query(
          `INSERT INTO subscription_plans 
           (name, display_name, type, price, billing_period, stripe_price_id, features, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [plan.name, plan.display_name, plan.type, plan.price, plan.billing_period, 
           plan.stripe_price_id, plan.features, plan.is_active]
        );
      }
    }

    // Show all plans
    const result = await pool.query(
      'SELECT name, display_name, type, price FROM subscription_plans ORDER BY type, price'
    );
    
    console.log('\n📋 All subscription plans:');
    console.log('─────────────────────────────────────────');
    result.rows.forEach(row => {
      const price = parseFloat(row.price) === 0 ? 'Grátis' : `R$ ${row.price}`;
      console.log(`  ${row.type.padEnd(8)} | ${row.display_name.padEnd(12)} | ${price}`);
    });
    console.log('─────────────────────────────────────────');

    console.log('\n✅ Done! Plans seeded successfully.');
    console.log('\n📌 Next steps:');
    console.log('   1. Create products in Stripe Dashboard');
    console.log('   2. Update stripe_price_id for paid plans');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seedPlans();

