-- Remove somente o dataset determinístico de demonstração.
-- IDs de campanhas reais da Meta são IDs do provedor e não usam cmp_01..cmp_06.
-- Leads reais recebidos pelo webhook usam UUID; os leads demo usam lead_0001...
-- lead_0400 e apontam para uma campanha demo.

do $$
begin
  if to_regclass('public.meta_conversion_events') is not null then
    execute $sql$
      delete from meta_conversion_events
       where lead_id in (
         select id
           from leads
          where id ~ '^lead_[0-9]{4}$'
            and campaign_id in ('cmp_01', 'cmp_02', 'cmp_03', 'cmp_04', 'cmp_05', 'cmp_06')
       )
    $sql$;
  end if;
end
$$;

delete from lead_events
 where lead_id in (
   select id
     from leads
    where id ~ '^lead_[0-9]{4}$'
      and campaign_id in ('cmp_01', 'cmp_02', 'cmp_03', 'cmp_04', 'cmp_05', 'cmp_06')
 );

delete from leads
 where id ~ '^lead_[0-9]{4}$'
   and campaign_id in ('cmp_01', 'cmp_02', 'cmp_03', 'cmp_04', 'cmp_05', 'cmp_06');

delete from daily_metrics
 where campaign_id in ('cmp_01', 'cmp_02', 'cmp_03', 'cmp_04', 'cmp_05', 'cmp_06');

delete from ads
 where campaign_id in ('cmp_01', 'cmp_02', 'cmp_03', 'cmp_04', 'cmp_05', 'cmp_06');

delete from ad_sets
 where campaign_id in ('cmp_01', 'cmp_02', 'cmp_03', 'cmp_04', 'cmp_05', 'cmp_06');

delete from campaigns
 where id in ('cmp_01', 'cmp_02', 'cmp_03', 'cmp_04', 'cmp_05', 'cmp_06');

delete from alerts
 where id in ('alert_01', 'alert_02', 'alert_03', 'alert_04', 'alert_05',
              'alert_06', 'alert_07', 'alert_08', 'alert_09', 'alert_10');
