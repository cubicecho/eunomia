import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { installRulePack, type RulePack } from '@/api';
import { StatusLine } from '@/components/status-line';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { errorMessage } from '@/hooks/use-query';

interface Props {
  packs: RulePack[];
  /** Called once an install lands: it adds a category and rules to the cards below. */
  reload(): void;
}

/**
 * The starter rule packs. Installing one writes plain rules into the table
 * below — from then on they are the user's to edit or delete — and sweeps the
 * rules over past activity, so the dashboard changes right away.
 *
 * Runs its own mutation rather than the view's `run`, like ApplyRules, because
 * the result is worth reporting: how many rules were written and how much time
 * moved. (An expired session surfaces on the reload that follows.)
 */
export function RulePacksCard({ packs, reload }: Props) {
  const [installing, setInstalling] = useState<string | null>(null);
  const [status, setStatus] = useState<{ text: string; failed: boolean } | null>(null);

  const install = (pack: RulePack) => {
    setInstalling(pack.id);
    installRulePack(pack.id)
      .then((result) => {
        const rules =
          result.added + result.updated === 0
            ? 'its rules were already installed'
            : [
                result.added > 0 &&
                  `${result.added} ${result.added === 1 ? 'rule' : 'rules'} added`,
                result.updated > 0 && `${result.updated} updated`,
              ]
                .filter(Boolean)
                .join(', ');
        const moved = `${result.categorized} ${result.categorized === 1 ? 'activity' : 'activities'}`;
        setStatus({ text: `${pack.name}: ${rules}; re-categorized ${moved}.`, failed: false });
        reload();
      })
      .catch((cause: unknown) => setStatus({ text: errorMessage(cause), failed: true }))
      .finally(() => setInstalling(null));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Rule packs</CardTitle>
        <CardDescription>
          Ready-made rules for well-known apps and sites. A pack adds a category (or fills yours of
          the same name) and ordinary rules you can edit or delete afterwards. Installing again
          never duplicates a rule.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ul className="flex flex-col">
          {packs.map((pack) => (
            <PackRow
              key={pack.id}
              pack={pack}
              pending={installing === pack.id}
              disabled={installing !== null}
              onInstall={() => install(pack)}
            />
          ))}
        </ul>
        <StatusLine status={status} />
      </CardContent>
    </Card>
  );
}

function PackRow({
  pack,
  pending,
  disabled,
  onInstall,
}: {
  pack: RulePack;
  pending: boolean;
  disabled: boolean;
  onInstall(): void;
}) {
  const [open, setOpen] = useState(false);
  const outdated = pack.installedVersion !== null && pack.installedVersion < pack.version;
  const installed = pack.installedVersion !== null && !outdated;

  return (
    <li className="flex items-start gap-3 border-b border-dashed py-2 last:border-0">
      <Collapsible open={open} onOpenChange={setOpen} className="min-w-0 grow">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{pack.name}</span>
          {installed && <Badge variant="secondary">Installed</Badge>}
          {outdated && <Badge variant="outline">Update available</Badge>}
        </div>
        <p className="text-muted-foreground text-sm">
          {pack.description} Category: {pack.categoryName}.
        </p>
        <CollapsibleTrigger className="text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-1 text-xs">
          <ChevronRight className={open ? 'size-3 rotate-90' : 'size-3'} />
          What it matches
        </CollapsibleTrigger>
        <CollapsibleContent className="flex flex-col gap-1 pt-1 text-xs">
          <PackList label="Apps" values={pack.apps} />
          <PackList label="Android packages" values={pack.packages} />
          <PackList label="Sites" values={pack.sites} />
        </CollapsibleContent>
      </Collapsible>
      <Button
        size="sm"
        variant={installed ? 'outline' : 'default'}
        disabled={disabled}
        onClick={onInstall}
      >
        {pending ? 'Installing…' : outdated ? 'Update' : installed ? 'Reinstall' : 'Install'}
      </Button>
    </li>
  );
}

function PackList({ label, values }: { label: string; values: string[] }) {
  if (values.length === 0) return null;
  return (
    <p className="text-muted-foreground break-words">
      <span className="text-foreground">{label}:</span> {values.join(', ')}
    </p>
  );
}
