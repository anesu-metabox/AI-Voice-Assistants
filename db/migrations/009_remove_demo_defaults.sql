-- Do not seed future tenants with sample company or assistant data.
ALTER TABLE company_profiles ALTER COLUMN company_name SET DEFAULT '';
ALTER TABLE company_profiles ALTER COLUMN website_url SET DEFAULT '';
ALTER TABLE company_profiles ALTER COLUMN company_phone SET DEFAULT '';
ALTER TABLE company_profiles ALTER COLUMN support_email SET DEFAULT '';
ALTER TABLE company_profiles ALTER COLUMN timezone SET DEFAULT 'Indian/Mauritius';
ALTER TABLE assistant_configs ALTER COLUMN assistant_name SET DEFAULT '';
ALTER TABLE assistant_configs ALTER COLUMN inbound_greeting SET DEFAULT '';
ALTER TABLE assistant_configs ALTER COLUMN system_prompt SET DEFAULT '';
ALTER TABLE assistant_configs ALTER COLUMN knowledge_base_notes SET DEFAULT '';
