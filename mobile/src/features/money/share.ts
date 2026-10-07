import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { api } from '../../api/client';
import type { ExportJobFull } from './types';

/**
 * Open a ready export (BRD §6.12). The server hands a 10-minute signed link
 * to a self-contained file: a PDF report is HTML with system fonts, printed
 * to a PDF on the phone (no internet needed for fonts); a CSV is shared as
 * it is. On the web the link opens in a new tab.
 */
export async function openExport(jobId: string): Promise<void> {
  const job = await api.get<ExportJobFull>(`/exports/${jobId}`);
  const url = job.download?.url;
  if (!url) throw new Error(job.status === 'failed' ? 'This export failed. Make a new one.' : 'This export has expired. Make a new one.');
  if (Platform.OS === 'web') {
    window.open(url, '_blank', 'noopener');
    return;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error('The download link expired. Try again.');
  const text = await res.text();
  if (job.kind === 'pdf') {
    const { uri } = await Print.printToFileAsync({ html: text });
    const named = `${FileSystem.cacheDirectory}${job.filename ?? 'houseplan-report.pdf'}`;
    await FileSystem.moveAsync({ from: uri, to: named }).catch(() => undefined);
    const exists = await FileSystem.getInfoAsync(named);
    await shareFile(exists.exists ? named : uri, 'application/pdf');
    return;
  }
  const path = `${FileSystem.cacheDirectory}${job.filename ?? 'houseplan.csv'}`;
  await FileSystem.writeAsStringAsync(path, text, { encoding: FileSystem.EncodingType.UTF8 });
  await shareFile(path, job.kind === 'csv' ? 'text/csv' : 'application/json');
}

async function shareFile(uri: string, mimeType: string) {
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this phone.');
  await Sharing.shareAsync(uri, { mimeType, dialogTitle: 'Share your HousePlan report' });
}
