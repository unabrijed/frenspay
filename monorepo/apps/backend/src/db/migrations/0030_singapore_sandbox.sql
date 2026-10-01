-- Recognition + isolated API sandbox only. No platform merchant, customer data, funds or live rail.
alter table merchants drop constraint merchants_rail_chk;
alter table merchants add constraint merchants_rail_chk check (payout_rail in ('UPI','QRIS','Pix','bank','PayNow'));
alter table quotes drop constraint quotes_payout_chk;
alter table quotes add constraint quotes_payout_chk check (payout_method in ('UPI','QRIS','Pix','bank','PayNow'));
alter table payout_providers drop constraint payout_providers_method_chk;
alter table payout_providers add constraint payout_providers_method_chk check (payout_method = '*' or payout_method in ('UPI','QRIS','Pix','bank','PayNow'));

insert into payout_providers (id, adapter, payout_method, priority, enabled)
values ('straitsx_sg_sandbox', 'straitsx_sandbox', 'PayNow', 10, false)
on conflict (id) do nothing;
