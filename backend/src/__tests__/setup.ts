// Test setup — point to test database environment
process.env.DB_HOST     = 'localhost';
process.env.DB_PORT     = '5432';
process.env.DB_NAME     = 'site_survey';
process.env.DB_USER     = 'survey_user';
process.env.DB_PASSWORD = 'survey_pass_2024';
process.env.DB_SSL      = 'false';
process.env.NODE_ENV    = 'test';
