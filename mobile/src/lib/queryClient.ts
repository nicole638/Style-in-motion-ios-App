// Shared React Query client singleton.
//
// Lives in its own module (rather than inline in _layout.tsx) so non-React
// code — e.g. Zustand stores — can invalidate/refetch queries after a
// mutation commits. followStore uses this to refresh the "Following" feed
// the moment a follow/unfollow write lands in the DB, race-free (the
// invalidation runs AFTER the awaited insert/delete, not on the optimistic
// state flip).

import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient();

export default queryClient;
