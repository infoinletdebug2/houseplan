import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { View } from 'react-native';
import { GUTTER, Screen } from '../../src/ui/Screen';
import { PhotoBand } from '../../src/ui/Tiles';
import { EmptyState, ErrorState, SkeletonList } from '../../src/ui/States';
import { Card } from '../../src/ui/Card';
import { T } from '../../src/ui/Text';
import { useTabBarSpace } from '../../src/ui/TabBar';
import { api } from '../../src/api/client';
import { KEYS } from '../../src/api/hooks';
import { useAuth } from '../../src/auth/context';
import { firstName } from '../../src/lib/format';
import { space } from '../../src/theme/tokens';
import type { ProjectSummary } from '../../src/types';

/**
 * Projects tab (S09). PLACEHOLDER shell owned by Fork M1: Fork M2 replaces
 * this with the full list (search, active/archived, limits, cards). The
 * empty state's one action opens the new-project wizard.
 */
export default function Projects() {
  const router = useRouter();
  const pad = useTabBarSpace();
  const { me } = useAuth();
  const q = useQuery({ queryKey: [...KEYS.projects, 'active'], queryFn: () => api.get<ProjectSummary[]>('/projects', { status: 'active' }) });

  return (
    <Screen noTopInset bottomPad={pad} gap={space.md} contentStyle={{ paddingHorizontal: 0, paddingTop: 0 }} refreshing={q.isRefetching} onRefresh={() => void q.refetch()}>
      <PhotoBand image="home-header" eyebrow="Your projects" title={`Hello, ${firstName(me?.user.display_name)}`} />
      <View style={{ paddingHorizontal: GUTTER, gap: space.md }}>
        {q.isLoading ? <SkeletonList rows={3} height={88} /> : null}
        {q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : null}
        {q.data && q.data.length === 0 ? (
          <EmptyState image="empty-projects" title="Start your first project" body="A new build, an extension or a renovation. We set up every budget category for you." action="Start a project" onAction={() => router.push('/project/new' as never)} />
        ) : null}
        {q.data?.map((p) => (
          <Card key={p.id} onPress={() => router.push(`/project/${p.id}` as never)} style={{ gap: 4 }}>
            <T v="h3">{p.name}</T>
          </Card>
        ))}
      </View>
    </Screen>
  );
}
