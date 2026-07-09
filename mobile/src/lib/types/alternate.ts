// Shape of one entry in creator_items.alternates (jsonb array).
// Snake_case fields mirror the legacy column names verbatim so backfilled
// rows from the legacy alternate_* columns deserialize without translation.
export type AlternateItem = {
  brand: string | null;
  category: string | null;
  label: string | null;
  link: string;
  name: string | null;
  photo_url: string | null;
  price: string | null;
};

export const MAX_ALTERNATES = 2;
