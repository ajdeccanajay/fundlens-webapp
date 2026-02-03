const { Client } = require('pg');
require('dotenv').config();

const LOCAL_DB = process.env.DATABASE_URL;
const RDS_DB = process.env.RDS_DATABASE_URL;

async function migrateTable(tab