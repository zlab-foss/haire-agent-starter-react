import { headers } from 'next/headers';
import { App } from '@/components/app';
import { getAppConfig } from '@/lib/utils';
import SinglePageDemo from '@/components/single-page-demo';

export default async function Page() {
  const hdrs = await headers();
  const appConfig = await getAppConfig(hdrs);

  // Pick which one:

  // Regular starter app
  // return <App appConfig={appConfig} />;

  // Single page demo
  return <SinglePageDemo />;
}
