/**
 * VISTA — Create Admin Account
 * Run from inside node-api/:  node src/scripts/seed-admin.js
 */

const path = require('path')

// Load .env
const envPath = path.join(__dirname, '../../../.env');
require('dotenv').config({ path: envPath })

const { Pool } = require('pg')
const bcrypt   = require('bcryptjs')

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME     || 'vista_db',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || '',
})

// ── Change these before running ───────────────────────────────
const ADMIN = {
  email:       'admin@vista.edu.ph',
  password:    'Admin@2025',
  surname:     'Administrator',
  first_name:  'Vista',
  middle_name: '',
  role:        'admin',
  phone:       '09000000000',
}
// ─────────────────────────────────────────────────────────────

async function seedAdmin() {
  const client = await pool.connect()
  try {
    console.log('🔌 Connected to:', process.env.DB_NAME)

    // Check if already exists
    const existing = await client.query(
      'SELECT id, email FROM users WHERE email = $1',
      [ADMIN.email]
    )

    if (existing.rows.length > 0) {
      console.log(`⚠️  User already exists: ${ADMIN.email}`)
      console.log('   Delete it first or change the email in this script.')
      return
    }

    // Hash password
    const salt          = await bcrypt.genSalt(12)
    const password_hash = await bcrypt.hash(ADMIN.password, salt)
    
    // Insert
    const result = await client.query(
      `INSERT INTO users (email, password_hash, surname, first_name, middle_name, role, phone)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, email, full_name, surname, first_name, role, created_at`,
      [ADMIN.email, password_hash, ADMIN.surname, ADMIN.first_name, ADMIN.middle_name||null, ADMIN.role, ADMIN.phone]
    )

    const user = result.rows[0]
    console.log('\n✅ Admin account created!\n')
    console.log('   ID:       ', user.id)
    console.log('   Name:     ', user.full_name)
    console.log('   Email:    ', user.email)
    console.log('   Role:     ', user.role)
    console.log('   Created:  ', user.created_at)
    console.log('\n── Login credentials ─────────────────────')
    console.log('   Email:    ', ADMIN.email)
    console.log('   Password: ', ADMIN.password)
    console.log('──────────────────────────────────────────\n')

  } finally {
    client.release()
    await pool.end()
  }
}

seedAdmin().catch(err => {
  console.error('❌ Seed failed:', err.message)
  process.exit(1)
})