-- Remove only the exact fictional values seeded by migration 005.
-- Preserve tenant rows and every field that does not exactly match a known
-- sample value; never delete a company or user record as part of this cleanup.

UPDATE company_profiles
SET company_name = CASE
        WHEN company_name = 'Acme Operations Inc.' THEN ''
        ELSE company_name
    END,
    website_url = CASE
        WHEN website_url = 'https://acmeops.com' THEN ''
        ELSE website_url
    END,
    company_phone = CASE
        WHEN company_phone = '+1 (555) 019-2834' THEN ''
        ELSE company_phone
    END,
    support_email = CASE
        WHEN support_email = 'support@acmeops.com' THEN ''
        ELSE support_email
    END,
    timezone = CASE
        WHEN timezone = 'America/New_York (EST)' THEN 'Indian/Mauritius'
        ELSE timezone
    END,
    updated_at = NOW()
WHERE company_name = 'Acme Operations Inc.'
   OR website_url = 'https://acmeops.com'
   OR company_phone = '+1 (555) 019-2834'
   OR support_email = 'support@acmeops.com'
   OR timezone = 'America/New_York (EST)';

UPDATE assistant_configs
SET assistant_name = CASE
        WHEN assistant_name = 'Support Agent – Charlie' THEN ''
        ELSE assistant_name
    END,
    inbound_greeting = CASE
        WHEN inbound_greeting = 'Thank you for calling Acme Operations Support. This is Ava, how can I assist you with your account settings today?'
            THEN ''
        ELSE inbound_greeting
    END,
    system_prompt = CASE
        WHEN system_prompt = 'You are a support voice agent. Your tone is warm, polite and direct. Resolve return inquiries using the attached knowledge base. Never invent details outside Acme guidelines. If client requests a tier override, trigger salesforce routing.'
            THEN ''
        ELSE system_prompt
    END,
    knowledge_base_notes = CASE
        WHEN knowledge_base_notes = 'Standard return window is 30 days. Priority tier requires Gold membership.'
            THEN ''
        ELSE knowledge_base_notes
    END,
    updated_at = NOW()
WHERE assistant_name = 'Support Agent – Charlie'
   OR inbound_greeting = 'Thank you for calling Acme Operations Support. This is Ava, how can I assist you with your account settings today?'
   OR system_prompt = 'You are a support voice agent. Your tone is warm, polite and direct. Resolve return inquiries using the attached knowledge base. Never invent details outside Acme guidelines. If client requests a tier override, trigger salesforce routing.'
   OR knowledge_base_notes = 'Standard return window is 30 days. Priority tier requires Gold membership.';
