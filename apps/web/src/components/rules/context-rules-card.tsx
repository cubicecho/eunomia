import { Trash2 } from 'lucide-react';
import { type ActivitySample, type ContextRule, deleteContextRule } from '@/api';
import { CardLayout } from '@/components/card-layout';
import { ConfirmButton } from '@/components/confirm-button';
import { EmptyState } from '@/components/empty-state';
import { ContextRuleForm } from '@/components/rules/context-rule-form';
import { Pattern } from '@/components/rules/pattern';
import { addRuleTrigger, editRuleTrigger, RuleDialog } from '@/components/rules/rule-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { Run } from '@/hooks/use-query';
import { describeExtractPattern } from '@/lib/pattern';

interface Props {
  rules: ContextRule[];
  /** The corpus the rule form previews against; may be empty. */
  samples: ActivitySample[];
  run: Run;
  reload: () => void;
}

export function ContextRulesCard({ rules, samples, run, reload }: Props) {
  return (
    <CardLayout
      title="Context rules"
      description="Splits an app’s time by what was open in it — the project in an editor, the site in a browser — by pulling the context out of the window title. Only applies to pings without a context of their own, and only going forward."
      actionSlot={
        <RuleDialog
          title="New context rule"
          description="Pick the part of the window title that names what was open — the preview shows what it would pull out of recent titles."
          trigger={addRuleTrigger('Add rule')}
        >
          {(host) => (
            <ContextRuleForm
              host={host}
              samples={samples}
              onSaved={() => {
                host.close();
                reload();
              }}
            />
          )}
        </RuleDialog>
      }
      contentSlot={
        rules.length === 0 ? null : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>App</TableHead>
                <TableHead>Context is</TableHead>
                <TableHead className="w-20">Priority</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...rules]
                .sort((a, b) => a.priority - b.priority)
                .map((rule) => (
                  <TableRow key={rule.id}>
                    <TableCell>
                      <Pattern value={rule.appPattern} />
                    </TableCell>
                    <TableCell>
                      <span className="text-muted-foreground text-sm" title={rule.titlePattern}>
                        {describeExtractPattern(rule.titlePattern)}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {rule.priority}
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center justify-end gap-1">
                        <RuleDialog
                          title="Edit context rule"
                          description="Saving replaces the rule. Activities already split by it keep the contexts they have; the new pattern applies from the next ping on."
                          trigger={editRuleTrigger('context rule')}
                        >
                          {(host) => (
                            <ContextRuleForm
                              host={host}
                              samples={samples}
                              rule={rule}
                              onSaved={() => {
                                host.close();
                                reload();
                              }}
                            />
                          )}
                        </RuleDialog>
                        <ConfirmButton
                          variant="outline"
                          size="icon-sm"
                          aria-label="Delete context rule"
                          hint="Delete context rule"
                          iconSlot={<Trash2 />}
                          title="Delete this context rule?"
                          description="Activities already split by this rule keep their contexts; new pings fold by app alone."
                          onConfirm={() => run(() => deleteContextRule(rule.id))}
                        />
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        )
      }
      emptySlot={
        <EmptyState compact title="No context rules yet — every app folds as one activity." />
      }
    />
  );
}
