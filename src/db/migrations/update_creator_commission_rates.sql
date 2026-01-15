-- Update creator commission rates to MVP rules (5% -> 3% -> 0%)
UPDATE subscription_plans
SET features = jsonb_set(features::jsonb, '{commission_rate}', '0.05'::jsonb)::text,
    updated_at = NOW()
WHERE name = 'creator_free';

UPDATE subscription_plans
SET features = jsonb_set(features::jsonb, '{commission_rate}', '0.03'::jsonb)::text,
    updated_at = NOW()
WHERE name = 'creator_basic';

UPDATE subscription_plans
SET features = jsonb_set(features::jsonb, '{commission_rate}', '0.0'::jsonb)::text,
    updated_at = NOW()
WHERE name = 'creator_pro';
