import { Screen, Header } from '../../src/ui/Screen';
import { LegalView } from '../../src/legal/LegalView';
import { TERMS } from '../../src/legal/content';

export default function TermsScreen() {
  return (
    <Screen header={<Header title="Terms of Service" />}>
      <LegalView doc={TERMS} />
    </Screen>
  );
}
