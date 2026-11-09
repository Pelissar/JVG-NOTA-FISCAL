-- Bucket publico apenas para marcas; escrita feita pelas rotas autenticadas do servidor.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'jvg-company-logos',
  'jvg-company-logos',
  true,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
