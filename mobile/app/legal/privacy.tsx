import { Screen, Header } from '../../src/ui/Screen';
import { LegalView } from '../../src/legal/LegalView';
import { PRIVACY } from '../../src/legal/content';

export default function PrivacyScreen() {
  return (
    <Screen header={<Header title="Privacy Policy" />}>
      <LegalView doc={PRIVACY} />
    </Screen>
  );
}
