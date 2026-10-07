import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Search } from 'lucide-react-native';
import { Sheet, SheetOption } from './Sheet';
import { Field } from './Field';
import { useColors } from '../theme/tokens';

/** A bottom sheet of options (country, currency, units, time zone), with search when the list is long. */
export function PickerSheet<V extends string>({
  visible,
  onClose,
  title,
  subtitle,
  options,
  value,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  options: Array<{ value: V; label: string; hint?: string }>;
  value: V | null | undefined;
  onPick: (v: V) => void;
}) {
  const c = useColors();
  const [q, setQ] = useState('');
  const long = options.length > 8;
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((o) => o.label.toLowerCase().includes(needle) || o.value.toLowerCase().includes(needle) || (o.hint ?? '').toLowerCase().includes(needle));
  }, [q, options]);
  return (
    <Sheet visible={visible} onClose={onClose} title={title} subtitle={subtitle} scroll={long}>
      {long ? (
        <View style={{ marginBottom: 8 }}>
          <Field label="Search" value={q} onChangeText={setQ} autoCorrect={false} icon={<Search size={18} color={c.muted} />} />
        </View>
      ) : null}
      {list.map((o) => (
        <SheetOption
          key={o.value}
          label={o.label}
          hint={o.hint}
          selected={o.value === value}
          onPress={() => {
            onPick(o.value);
            setQ('');
            onClose();
          }}
        />
      ))}
    </Sheet>
  );
}

/** Time zones offered when the platform cannot list them; the phone's own zone is always first. */
export function timeZones(phone: string): string[] {
  let all: string[] = [];
  try {
    all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
  } catch {
    all = [];
  }
  if (all.length === 0) {
    all = [
      'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Phoenix', 'America/Anchorage', 'Pacific/Honolulu', 'America/Toronto',
      'America/Vancouver', 'America/Mexico_City', 'America/Sao_Paulo', 'Europe/London', 'Europe/Dublin', 'Europe/Lisbon', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid',
      'Europe/Rome', 'Europe/Amsterdam', 'Europe/Stockholm', 'Europe/Warsaw', 'Europe/Athens', 'Africa/Johannesburg', 'Africa/Lagos', 'Africa/Nairobi', 'Asia/Dubai',
      'Asia/Riyadh', 'Asia/Karachi', 'Asia/Kolkata', 'Asia/Dhaka', 'Asia/Singapore', 'Asia/Kuala_Lumpur', 'Asia/Manila', 'Asia/Tokyo', 'Asia/Seoul', 'Australia/Sydney',
      'Australia/Melbourne', 'Australia/Perth', 'Pacific/Auckland', 'UTC',
    ];
  }
  return [phone, ...all.filter((z) => z !== phone)];
}
