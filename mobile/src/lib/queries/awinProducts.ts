import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface AwinProduct {
  id: string;
  merchantId: string;            // FK → affiliate_merchants.id (Supabase row PK)
  network: 'awin' | 'rakuten';
  productIdInFeed: string | null;
  sku: string | null;
  name: string;
  description: string | null;
  brand: string | null;
  category: string | null;
  department: string | null;
  merchantCategory: string | null;
  price: number | null;
  searchPrice: number | null;
  currency: string | null;
  imageUrls: string[];
  lifestyleImageUrl: string | null;
  productUrl: string;
  deepLink: string | null;
  inStock: boolean;
  createdAt: string;
}

export interface BrandDepartment {
  department: string;
  count: number;
}

function rowToProduct(row: any, fallbackMerchantId?: string): AwinProduct {
  return {
    id: String(row.id),
    merchantId: String(row.merchant_id ?? fallbackMerchantId ?? ''),
    network: (row.network === 'rakuten' ? 'rakuten' : 'awin') as 'awin' | 'rakuten',
    productIdInFeed: row.product_id_in_feed ?? null,
    sku: row.sku ?? null,
    name: row.name ?? '',
    description: row.description ?? null,
    brand: row.brand ?? null,
    category: row.category ?? null,
    department: row.department ?? null,
    merchantCategory: row.merchant_category ?? null,
    price: row.price === null || row.price === undefined ? null : Number(row.price),
    searchPrice: row.search_price === null || row.search_price === undefined ? null : Number(row.search_price),
    currency: row.currency ?? null,
    imageUrls: Array.isArray(row.image_urls) ? row.image_urls.filter(Boolean) : [],
    lifestyleImageUrl: row.lifestyle_image_url ?? null,
    productUrl: row.product_url ?? '',
    deepLink: row.deep_link ?? null,
    inStock: row.in_stock !== false,
    createdAt: row.created_at ?? '',
  };
}

const PAGE_SIZE = 60;

/**
 * Paged list of products for one merchant via the get_brand_catalog RPC.
 * Optional department + free-text search compose server-side.
 * Use with FlatList onEndReached → fetchNextPage().
 */
export function useAwinProductsByMerchant(
  merchantId: string | null | undefined,
  query?: string,
  department?: string | null,
) {
  const trimmed = (query ?? '').trim().toLowerCase();
  const search = trimmed.length > 0 ? trimmed : null;
  const dept = department && department.length > 0 ? department : null;
  return useInfiniteQuery({
    queryKey: ['awin', 'products', 'byMerchant', merchantId ?? '', dept, search],
    enabled: !!merchantId,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const offset = (pageParam as number) * PAGE_SIZE;
      const { data, error } = await supabase.rpc('get_brand_catalog', {
        p_merchant_id: merchantId,
        p_department: dept,
        p_search: search,
        p_limit: PAGE_SIZE,
        p_offset: offset,
      });
      if (error) {
        console.warn('[useAwinProductsByMerchant] error:', error.message);
        throw error;
      }
      return (data ?? []).map((row: any) => rowToProduct(row, merchantId ?? undefined));
    },
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length < PAGE_SIZE ? undefined : allPages.length,
    staleTime: 1000 * 60 * 5,
  });
}

/**
 * Department chip data for a brand. Returns departments ordered by count desc.
 */
export function useBrandDepartments(merchantId: string | null | undefined) {
  return useQuery({
    queryKey: ['awin', 'brandDepartments', merchantId ?? ''],
    enabled: !!merchantId,
    queryFn: async (): Promise<BrandDepartment[]> => {
      const { data, error } = await supabase.rpc('get_brand_departments', {
        p_merchant_id: merchantId,
      });
      if (error) {
        console.warn('[useBrandDepartments] error:', error.message);
        throw error;
      }
      return (data ?? [])
        .map((row: any) => ({
          department: String(row.department ?? ''),
          count: Number(row.count ?? 0),
        }))
        .filter((d: BrandDepartment) => d.department.length > 0);
    },
    staleTime: 1000 * 60 * 10,
  });
}

