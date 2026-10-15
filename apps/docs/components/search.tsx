'use client';

import { useDocsSearch } from 'fumadocs-core/search/client';
import { staticClient } from 'fumadocs-core/search/client/orama-static';
import {
  SearchDialog, SearchDialogClose, SearchDialogContent, SearchDialogHeader,
  SearchDialogIcon, SearchDialogInput, SearchDialogList, SearchDialogOverlay,
  type SharedProps,
} from 'fumadocs-ui/components/dialog/search';
import { Alert, EmptyState } from '@bloxwap/hig-react/status';
import { assetUrl } from '@/lib/site';

/** No-results state; the static index needs no retry, so it points at commands and the plain page list instead. */
function NoResults() {
  return <div className="search-state" role="status">
    <EmptyState title="No matching pages" description="Try a command such as order or run, an error code, or a topic such as custody." />
  </div>;
}

export default function StaticSearch(props: SharedProps) {
  const { search, setSearch, query } = useDocsSearch({
    client: staticClient({ from: assetUrl('/search.json') }),
  });
  return (
    <SearchDialog search={search} onSearchChange={setSearch} isLoading={query.isLoading} {...props}>
      <SearchDialogOverlay />
      <SearchDialogContent>
        <SearchDialogHeader><SearchDialogIcon /><SearchDialogInput /><SearchDialogClose /></SearchDialogHeader>
        {query.error
          ? <div className="search-state">
            <Alert title="Search is unavailable" severity="error">
              <p>Use the documentation navigation, or open <a className="hig-link" href={assetUrl('/llms.txt')}>llms.txt</a> for a plain list of pages.</p>
            </Alert>
          </div>
          : <SearchDialogList items={query.data === 'empty' ? null : query.data} Empty={NoResults} />}
      </SearchDialogContent>
    </SearchDialog>
  );
}
