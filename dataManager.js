const mysql = require('mysql2/promise');
const bunyan = require('bunyan');

// 创建一个日志记录器
const logger = bunyan.createLogger({
  name: 'myapp',
  level: 'error',
  streams: [
    { path: './myapp.log' },
    { stream: process.stdout }
  ]
});

class MySqlManager {
  constructor(config) {
    this.config = config;
    this.connection = null;
  }

  async connect() {
    try {
      this.connection = await mysql.createConnection(this.config);

      const [res] = await this.connection.execute(`
      CREATE TABLE IF NOT EXISTS t_users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(36) NOT NULL,
        password VARCHAR(36) NOT NULL,
        totalCount INT NOT NULL DEFAULT 0,
        status INT(2) NOT NULL DEFAULT 0,
        dailyCount INT NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE unique_index_name (username)
        ) AUTO_INCREMENT = 889527;
    `);

    const [result] = await this.connection.execute(`
    CREATE TABLE IF NOT EXISTS t_user_daily (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
      date date NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE unique_index_name (date,user_id)
    )
  `);
      
    const [result_key] = await this.connection.execute(`
    CREATE TABLE IF NOT EXISTS t_session_key (
      id INT AUTO_INCREMENT PRIMARY KEY,
      session_key VARCHAR(36) NOT NULL,
      openid VARCHAR(36) NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE unique_index_name (session_key,openid)
    )
  `);
      console.log(`Connected to MySQL database successfully:${res}`);
    } catch (err) {
      console.error(`Unable to connect to MySQL database: ${err}`);
    }
  }

  async close() {
    try {
      await this.connection.end();
      console.log('MySQL connection closed successfully');
    } catch (err) {
      console.error(`Unable to close MySQL connection: ${err}`);
    }
  }

  async execute(sql, values) {
    try {
      const [rows] = await this.connection.execute(sql, values);
      return rows;
    } catch (err) {
      console.error(`Error executing query: ${err}`);
      logger.error(err);
    }
  }

  async insert(table, data) {
    const keys = Object.keys(data);
    const values = Object.values(data);
    const placeholders = keys.map(() => '?').join(', ');
    const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`;
    return this.execute(sql, values);
  }

  async update(table, data, where) {
    const set = Object.keys(data).map(key => `${key} = ?`).join(', ');
    const values = Object.values(data);
    const whereClause = Object.keys(where).map(key => `${key} = ?`).join(' AND ');
    const whereValues = Object.values(where);
    const sql = `UPDATE ${table} SET ${set} WHERE ${whereClause}`;
    return this.execute(sql, [...values, ...whereValues]);
  }

  async delete(table, where) {
    const whereClause = Object.keys(where).map(key => `${key} = ?`).join(' AND ');
    const whereValues = Object.values(where);
    const sql = `DELETE FROM ${table} WHERE ${whereClause}`;
    return this.execute(sql, whereValues);
  }

  async select(table, where) {
    const whereClause = Object.keys(where).map(key => `${key} = ?`).join(' AND ');
    const whereValues = Object.values(where);
    const sql = `SELECT * FROM ${table} WHERE ${whereClause}`;
    return this.execute(sql, whereValues);
  }
}

module.exports = MySqlManager;
