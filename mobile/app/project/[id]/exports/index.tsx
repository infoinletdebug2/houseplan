import { useState } from 'react';
import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { FileDown, FileSpreadsheet, FileText } from 'lucide-react-native';
import { Screen, Header, SectionHeader } from '../../../../src/ui/Screen';
import { T } from '../../../../src/ui/Text';
import { Card, IconSquare } from '../../../../src/ui/Card';
import { Button } from '../../../../src/ui/Button';
import { ToggleRow } from '../../../../src/ui/Banner';
import { ChoiceTile, TileGrid } from '../../../../src/ui/Tiles';
import { ConfirmSheet, useToast } from '../../../../src/ui/Sheet';
import { api, messageOf, type ApiError } from '../../../../src/api/client';
import { pKey, projectPath } from '../../../../src/api/hooks';
import { ago } from '../../../../src/lib/format';
import { noteSuccess } from '../../../../src/lib/review';
import { space } from '../../../../src/theme/tokens';
import { FieldNote, Gate, StatusPill, writeMessage } from '../../../../src/features/money/ui';
import { openExport } from '../../../../src/features/money/share';
import { useProjectId, useProjectLite, useSubmit } from '../../../../src/features/money/data';
import type { ExportJobFull, RevisionLite } from '../../../../src/features/money/types';

type Section = 'estimate' | 'exclusions' | 'contingency' | 'provenance' | 'scenario' | 'finance' | 'forecast';
const SECTIONS: Array<{ key: Section; label: string; hint: string }> = [
  { key: 'estimate', label: 'Estimate', hint: 'Every category and line, with completeness' },
  { key: 'exclusions', label: 'Exclusions', hint: 'What is not included or still undecided' },
  { key: 'contingency', label: 'Reserve', hint: 'Your contingency and what it covers' },
  { key: 'provenance', label: 'Where prices came from', hint: 'Rate sources and dates' },
  { key: 'finance', label: 'Money so far', hint: 'Commitments, invoices and payments' },
  { key: 'forecast', label: 'Forecast to finish', hint: 'The latest confirmed forecast' },
];

/**
 * S36 exports: a PDF report or a CSV of one saved revision. The report is
 * built from a frozen snapshot, so it never changes after it is made; the
 * address is left out unless you include it. Links last 10 minutes; a shared
 * copy cannot be taken back.
 */
export default function Exports() {
  const toast = useToast();
  const pid = useProjectId();
  const project = useProjectLite(pid);
  const revisions = useQuery<{ revisions: RevisionLite[] }, ApiError>({ queryKey: pKey(pid, 'estimates', 'all'), queryFn: () => api.get(projectPath(pid, 'estimates'), { kind: 'all' }), enabled: Boolean(pid) });
  const jobs = useQuery<ExportJobFull[], ApiError>({ queryKey: ['me', 'exports'], queryFn: () => api.get<ExportJobFull[]>('/exports') });
  const submit = useSubmit();
  const [kind, setKind] = useState<'pdf' | 'csv'>('pdf');
  const [revision, setRevision] = useState<string | null>(null);
  const [sections, setSections] = useState<Section[]>(['estimate', 'exclusions', 'contingency', 'provenance']);
  const [address, setAddress] = useState(false);
  const [sharing, setSharing] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  const frozen = (revisions.data?.revisions ?? []).filter((r) => r.status === 'frozen' && r.kind === 'current');
  const chosen = revision ?? frozen.find((r) => r.is_current)?.id ?? frozen[0]?.id ?? null;
  const mine = (jobs.data ?? []).filter((j) => j.project_id === pid);

  const make = async () => {
    try {
      const job = await submit.run<ExportJobFull>('POST', projectPath(pid, 'exports'), { kind, revision_id: chosen, sections: [...sections, 'limitations'], include_address: address });
      void jobs.refetch();
      setSharing(job.id);
    } catch (err) {
      toast.show(writeMessage(err), 'error');
    }
  };

  const share = async (id: string) => {
    setOpening(true);
    try {
      await openExport(id);
      setTimeout(() => void noteSuccess('export_shared'), 2500);
    } catch (err) {
      toast.show(messageOf(err), 'error');
    } finally {
      setOpening(false);
      setSharing(null);
    }
  };

  return (
    <Screen header={<Header title="Reports" />} footer={<Button title={kind === 'pdf' ? 'Make the PDF report' : 'Make the CSV file'} onPress={() => void make()} loading={submit.busy} testID="export-make" />} gap={space.md}>
      {project.data ? <T v="small">{project.data.name}</T> : null}
      <TileGrid>
        <ChoiceTile label="PDF report" hint="To read, print or send" selected={kind === 'pdf'} onPress={() => { submit.fresh(); setKind('pdf'); }} icon={(col) => <FileText size={18} color={col} />} meaning="documents" />
        <ChoiceTile label="CSV file" hint="For a spreadsheet" selected={kind === 'csv'} onPress={() => { submit.fresh(); setKind('csv'); }} icon={(col) => <FileSpreadsheet size={18} color={col} />} meaning="documents" />
      </TileGrid>

      <SectionHeader title="Which revision" />
      <Gate q={revisions} rows={1} height={56}>
        {() =>
          frozen.length === 0 ? (
            <FieldNote>No saved revision yet: the report uses your current draft. Save the estimate for a report that never changes.</FieldNote>
          ) : (
            <TileGrid>
              {frozen.slice(0, 6).map((r) => (
                <ChoiceTile key={r.id} label={`Revision ${r.revision_number}`} hint={r.is_current ? 'Current' : r.is_baseline ? 'Baseline' : r.title} selected={chosen === r.id} onPress={() => { submit.fresh(); setRevision(r.id); }} />
              ))}
            </TileGrid>
          )
        }
      </Gate>

      <SectionHeader title="Include" />
      <Card style={{ gap: 0 }}>
        {SECTIONS.map((s) => (
          <ToggleRow key={s.key} label={s.label} hint={s.hint} value={sections.includes(s.key)} onChange={(v) => { submit.fresh(); setSections((cur) => (v ? [...cur, s.key] : cur.filter((x) => x !== s.key))); }} />
        ))}
        <ToggleRow label="The house address" hint="Off by default. Reports leave the address out." value={address} onChange={(v) => { submit.fresh(); setAddress(v); }} />
      </Card>
      <T v="small">Every report ends with its limitations: it is a planning estimate, not a quotation.</T>

      {mine.length ? (
        <View style={{ gap: space.sm }}>
          <SectionHeader title="Recent" />
          {mine.slice(0, 8).map((j) => (
            <Card key={j.id} onPress={j.status === 'ready' ? () => setSharing(j.id) : undefined} style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
              <IconSquare meaning="documents" icon={(col) => <FileDown size={19} color={col} />} />
              <View style={{ flex: 1, gap: 2 }}>
                <T v="bodyStrong" numberOfLines={2}>
                  {j.filename ?? (j.kind === 'pdf' ? 'PDF report' : 'CSV file')}
                </T>
                <T v="small">Made {ago(j.created_at)}</T>
              </View>
              <StatusPill label={j.status === 'ready' ? 'Ready' : j.status === 'queued' ? 'Preparing' : j.status === 'failed' ? 'Failed' : 'Expired'} tone={j.status === 'ready' ? 'ok' : j.status === 'failed' ? 'danger' : 'grey'} />
            </Card>
          ))}
        </View>
      ) : null}

      <ConfirmSheet
        visible={sharing !== null}
        onClose={() => setSharing(null)}
        title="Your report is ready"
        message="Whoever you send it to gets a copy you cannot take back later. It shows planning estimates, not a builder's quote."
        confirmLabel="Open and share"
        onConfirm={() => sharing && void share(sharing)}
        loading={opening}
      />
    </Screen>
  );
}
