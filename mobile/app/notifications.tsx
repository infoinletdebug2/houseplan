import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react-native';
import { Screen, Header } from '../src/ui/Screen';
import { T } from '../src/ui/Text';
import { Button } from '../src/ui/Button';
import { IconSquare } from '../src/ui/Card';
import { EmptyState } from '../src/ui/States';
import { useToast } from '../src/ui/Sheet';
import { api, messageOf, type ApiError } from '../src/api/client';
import { useAuth } from '../src/auth/context';
import { ago } from '../src/lib/format';
import { radius, space, useColors } from '../src/theme/tokens';
import { Gate } from '../src/features/money/ui';

interface Note {
  id: string;
  title: string;
  body: string | null;
  category?: string;
  data?: { route?: string; project_id?: string } | null;
  read_at?: string | null;
  readAt?: string | null;
  created_at?: string;
  createdAt?: string;
}

/**
 * S37 notifications: quote expiry, phase start, material dates, budget and
 * export notices. A tap opens the screen it is about — through the normal
 * routes, so an ended plan lands on the paywall and another person's project
 * on "not here", never on data it should not show.
 */
export default function Notifications() {
  const router = useRouter();
  const toast = useToast();
  const c = useColors();
  const qc = useQueryClient();
  const { me } = useAuth();
  const q = useQuery<Note[], ApiError>({ queryKey: ['me', 'notifications'], queryFn: () => api.get<Note[]>('/notifications', { limit: 50 }) });
  const unread = (q.data ?? []).filter((n) => !(n.read_at ?? n.readAt)).length;

  const open = async (n: Note) => {
    if (!(n.read_at ?? n.readAt)) {
      void api.post(`/notifications/${n.id}/read`).then(() => qc.invalidateQueries({ queryKey: ['me', 'notifications'] })).catch(() => undefined);
    }
    const route = n.data?.route;
    if (!route) return;
    if (!me?.entitlement.access) return router.push('/paywall');
    // Only routes inside the app are followed.
    if (route.startsWith('/')) router.push(route.replace(/^\/projects\//, '/project/') as never);
  };

  const readAll = async () => {
    try {
      await api.post('/notifications/read-all');
      void qc.invalidateQueries({ queryKey: ['me', 'notifications'] });
    } catch (err) {
      toast.show(messageOf(err), 'error');
    }
  };

  return (
    <Screen header={<Header title="Notifications" />} refreshing={q.isRefetching} onRefresh={() => void q.refetch()} footer={unread > 0 ? <Button title="Mark all as read" kind="outline" onPress={() => void readAll()} /> : undefined} gap={space.sm}>
      <Gate q={q} rows={5} height={70}>
        {(all) =>
          all.length === 0 ? (
            <EmptyState compact title="Nothing new" body="Quote expiry, phase start, material dates and budget alerts arrive here. Choose which ones in Settings." />
          ) : (
            all.map((n) => {
              const isUnread = !(n.read_at ?? n.readAt);
              return (
                <Pressable key={n.id} onPress={() => void open(n)} accessibilityRole="button" style={({ pressed }) => ({ flexDirection: 'row', gap: space.sm, padding: space.md, borderRadius: radius.card, backgroundColor: isUnread ? c.primaryTint : c.surface, borderWidth: 1, borderColor: c.line, opacity: pressed ? 0.85 : 1 })}>
                  <IconSquare meaning={n.category === 'budget' ? 'alerts' : n.category === 'quotes' ? 'documents' : 'services'} icon={(col) => <Bell size={18} color={col} />} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <T v="bodyStrong">{n.title}</T>
                    {n.body ? <T v="small">{n.body}</T> : null}
                    <T v="caption">
                      {isUnread ? 'New · ' : ''}
                      {ago(n.created_at ?? n.createdAt)}
                    </T>
                  </View>
                </Pressable>
              );
            })
          )
        }
      </Gate>
    </Screen>
  );
}
