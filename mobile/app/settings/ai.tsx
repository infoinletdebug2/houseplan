import { useState } from 'react';
import { View } from 'react-native';
import { BrainCircuit } from 'lucide-react-native';
import { Screen, Header } from '../../src/ui/Screen';
import { T } from '../../src/ui/Text';
import { Button } from '../../src/ui/Button';
import { Card } from '../../src/ui/Card';
import { BrandBanner, ToggleRow } from '../../src/ui/Banner';
import { ConfirmSheet, useToast } from '../../src/ui/Sheet';
import { useAuth } from '../../src/auth/context';
import { api, messageOf } from '../../src/api/client';
import { CONSENT_POLICY_VERSION } from '../../src/config';
import { space } from '../../src/theme/tokens';

/**
 * AI advisor consent (BRD §6.11): explicit, optional, revocable. Says who
 * processes what. Declining keeps every calculation and comparison working.
 * Advice history can be deleted.
 */
export default function AiSettings() {
  const toast = useToast();
  const { me, refresh } = useAuth();
  const [busy, setBusy] = useState(false);
  const [clearing, setClearing] = useState(false);
  const on = Boolean(me?.ai_consent?.granted);

  const change = async (granted: boolean) => {
    setBusy(true);
    try {
      await api.post('/me/consents', { purpose: 'ai_processing', granted, policy_version: CONSENT_POLICY_VERSION });
      await refresh();
      toast.show(granted ? 'AI advisor on' : 'AI advisor off');
    } catch (e) {
      toast.show(messageOf(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    try {
      const r = await api.delete<{ deleted: number }>('/me/advice-history');
      toast.show(r?.deleted ? `Deleted ${r.deleted} answers` : 'Advice history deleted');
    } catch (e) {
      toast.show(messageOf(e), 'error');
    } finally {
      setBusy(false);
      setClearing(false);
    }
  };

  return (
    <Screen header={<Header title="AI advisor" />} gap={space.md}>
      <BrandBanner icon={(col) => <BrainCircuit size={22} color={col} />} title="Explains your numbers, never invents them" body="Totals and quantities always come from HousePlan's own exact calculations. The advisor explains them and suggests questions." />
      <Card style={{ gap: 8 }}>
        <ToggleRow label="Use the AI advisor" hint="Off until you turn it on. You can turn it off any time." value={on} disabled={busy} onChange={(v) => void change(v)} testID="ai-consent" />
      </Card>
      <View style={{ gap: 6 }}>
        <T v="bodyStrong">What is sent, and to whom</T>
        <T v="small">
          When you ask a question, HousePlan sends a summary of the project you are asking about to our AI provider through Xenition: the project type and country, room sizes, the categories and lines of the estimate with their totals and price dates, and your question.
        </T>
        <T v="small">Never sent: your address or postcode, supplier names or contacts, photos, PDFs or other files. The provider is asked not to keep or train on the request.</T>
        <T v="small">You get 30 questions in any 30 days. Saying no keeps every calculator, estimate and comparison working.</T>
      </View>
      <Button title="Delete my advice history" kind="dangerSoft" onPress={() => setClearing(true)} />
      <ConfirmSheet visible={clearing} onClose={() => setClearing(false)} title="Delete advice history?" message="Every saved advisor answer is removed. Your projects are not touched." confirmLabel="Delete history" destructive loading={busy} onConfirm={() => void clear()} />
    </Screen>
  );
}
