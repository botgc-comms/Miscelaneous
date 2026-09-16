import { ServiceTools } from './service-tools';
import Entry from './entry';
import { PrivatePreview } from './private-preview';
export default function Home() {
  return (
    <PrivatePreview>
      <ServiceTools />
      <Entry />
    </PrivatePreview>
  );
}
