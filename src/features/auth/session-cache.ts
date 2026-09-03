import type { QueryClient } from '@tanstack/react-query';

export async function clearSessionQueryCache(queryClient: QueryClient): Promise<void> {
  await queryClient.cancelQueries();
  queryClient.removeQueries({
    predicate: (query) => query.queryKey[0] !== 'current-user',
  });
  queryClient.setQueryData(['current-user'], null);
}
