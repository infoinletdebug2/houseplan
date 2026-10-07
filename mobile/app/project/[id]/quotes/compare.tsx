import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Screen, Header, SectionHeader } from '../../../../src/ui/Screen';
import { T } from '../../../../src/ui/Text';
import { Card } from '../../../../src/ui/Card';
import { Button } from '../../../../src/ui/Button';
import { ChoiceTile, TileGrid } from '../../../../src/ui/Tiles';
import { useToast } from '../../../../src/ui/Sheet';
import { api, type ApiError } from '../../../../src/api/client';
import { pKey, projectPath } from '../../../../src/api/hooks';
import { money } from '../../../../src/lib/format';
import { font, radius, space, useColors } from '../../../../src/theme/tokens';
import { Gate, WarnNote, FieldNote, writeMessage } from '../../../../src/features/money/ui';
import { useProjectId, useProjectLite, useSubmit } from '../../../../src/features/money/data';
import type { Comparison, Quote } from '../../../../src/features/money/types';

/**
 * Compare 2–4 quotes (BRD §6.8). Rows are budget categories (the server's
 * honest default without a manual mapping); a missing price is a gap, never
 * zero; unmatched lines and excluded scope stay visible under every column.
 */
export default function CompareQuotes() {
  const c = useColors();
  const toast = useToast();
  const pid = useProjectId();
  const project = useProjectLite(pid);
  const cur = project.data?.currency ?? 'USD';
  const quotes = useQuery<Quote[], ApiError>({ queryKey: pKey(pid, 'quotes'), queryFn: () => api.get<Quote[]>(projectPath(pid, 'quotes')), enabled: Boolean(pid) });
  const [picked, setPicked] = useState<string[]>([]);
  const [result, setResult] = useState<Comparison | null>(null);
  const submit = useSubmit();

  const toggle = (id: string) => {
    submit.fresh();
    setResult(null);
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 4 ? p : [...p, id]));
  };

  const run = async () => {
    try {
      setResult(await submit.run<Comparison>('POST', projectPath(pid, 'quote-comparison'), { quote_ids: picked }));
    } catch (err) {
      toast.show(writeMessage(err), 'error');
    }
  };

  const colW = 128;
  return (
    <Screen header={<Header title="Compare quotes" />} footer={result ? undefined : <Button title={picked.length < 2 ? 'Choose at least two quotes' : `Compare ${picked.length} quotes`} disabled={picked.length < 2} blockedReason="Choose two to four quotes to compare." onPress={() => void run()} loading={submit.busy} testID="compare-run" />} gap={space.md}>
      <Gate q={quotes} rows={3}>
        {(all) => {
          const usable = all.filter((q) => q.status !== 'superseded');
          if (!result) {
            return (
              <>
                <T v="small">Choose two to four quotes for the same work.</T>
                <TileGrid>
                  {usable.map((q) => (
                    <ChoiceTile key={q.id} multi label={q.title} hint={`${q.supplier_name ?? 'No supplier'} · ${money(q.gross_minor, cur)}`} selected={picked.includes(q.id)} onPress={() => toggle(q.id)} />
                  ))}
                </TileGrid>
              </>
            );
          }
          const qs = result.quotes;
          const totals = Object.fromEntries(qs.map((q) => [q.id, q.gross_minor]));
          return (
            <>
              {result.complete ? <FieldNote>{result.note}</FieldNote> : <WarnNote>{result.note}</WarnNote>}
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={{ borderRadius: radius.card, borderWidth: 1, borderColor: c.line, backgroundColor: c.surface, overflow: 'hidden' }}>
                  <View style={{ flexDirection: 'row', backgroundColor: c.brandTint }}>
                    <View style={{ width: 132, padding: 12 }}>
                      <T v="label" color={c.muted}>
                        Work
                      </T>
                    </View>
                    {qs.map((q) => (
                      <View key={q.id} style={{ width: colW, padding: 12, gap: 2 }}>
                        <T v="label" numberOfLines={2}>
                          {q.supplier_name ?? q.title}
                        </T>
                        <T v="caption" numberOfLines={1}>
                          {q.title}
                        </T>
                      </View>
                    ))}
                  </View>
                  {result.rows.map((r) => {
                    const present = Object.values(r.cells).filter((v): v is string => v !== null).map((v) => BigInt(v));
                    const min = present.length ? present.reduce((a, b) => (b < a ? b : a)) : null;
                    return (
                      <View key={r.key} style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: c.line }}>
                        <View style={{ width: 132, padding: 12 }}>
                          <T v="smallStrong" numberOfLines={2}>
                            {r.label}
                          </T>
                        </View>
                        {qs.map((q) => {
                          const v = r.cells[q.id] ?? null;
                          const lowest = v !== null && min !== null && BigInt(v) === min && present.length > 1;
                          return (
                            <View key={q.id} style={{ width: colW, padding: 12 }}>
                              <T style={{ fontFamily: lowest ? font.bold : font.semibold, fontSize: 14, color: v === null ? c.warn : c.ink }} num>
                                {v === null ? 'Not quoted' : money(v, cur)}
                              </T>
                            </View>
                          );
                        })}
                      </View>
                    );
                  })}
                  <View style={{ flexDirection: 'row', borderTopWidth: 2, borderTopColor: c.brand }}>
                    <View style={{ width: 132, padding: 12 }}>
                      <T v="bodyStrong">Quoted total</T>
                    </View>
                    {qs.map((q) => (
                      <View key={q.id} style={{ width: colW, padding: 12 }}>
                        <T v="money" num>
                          {money(totals[q.id] ?? null, cur)}
                        </T>
                      </View>
                    ))}
                  </View>
                </View>
              </ScrollView>

              <SectionHeader title="Scope differences" />
              {qs.map((q) => {
                const unmatched = result.unmatched[q.id] ?? [];
                const excluded = result.excluded_scope[q.id];
                return (
                  <Card key={q.id} style={{ gap: 6 }}>
                    <T v="bodyStrong">{q.supplier_name ?? q.title}</T>
                    {excluded ? (
                      <T v="small">
                        <T v="smallStrong" color={c.danger}>
                          Not included:{' '}
                        </T>
                        {excluded}
                      </T>
                    ) : (
                      <T v="small">No exclusions written on this quote. Ask the supplier to confirm.</T>
                    )}
                    {unmatched.length ? (
                      <View style={{ gap: 2 }}>
                        <T v="smallStrong">Lines with no match in the others</T>
                        {unmatched.map((u) => (
                          <T v="small" key={u.id}>
                            {u.description} · {money(u.gross_minor, cur)}
                          </T>
                        ))}
                      </View>
                    ) : null}
                  </Card>
                );
              })}
              <T v="small" center>
                The cheapest total is not a recommendation until the scope differences are reviewed.
              </T>
              <Button title="Choose other quotes" kind="outline" onPress={() => setResult(null)} />
            </>
          );
        }}
      </Gate>
    </Screen>
  );
}
