import { type ActivitySample, type ContextRule, deleteContextRule } from '@/api';
import { ConfirmDelete } from '@/components/confirm-delete';
import { EmptyState } from '@/components/empty-state';
import { ContextRuleForm } from '@/components/rules/context-rule-form';
import { Pattern } from '@/components/rules/pattern';
import { AddRuleButton, EditRuleButton, RuleDialog } from '@/components/rules/rule-dialog';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
    <Card>
      <CardHeader>
        <CardTitle>Context rules</CardTitle>
        <CardDescription>
          Splits an app’s time by what was open in it — the project in an editor, the site in a
          browser — by pulling the context out of the window title. Only applies to pings without a
          context of their own, and only going forward.
        </CardDescription>
        <CardAction>
          <RuleDialog
            title="New context rule"
            description="Pick the part of the window title that names what was open — the preview shows what it would pull out of recent titles."
            trigger={<AddRuleButton label="Add rule" />}
          >
            {(close) => (
              <ContextRuleForm
                samples={samples}
                onSaved={() => {
                  close();
                  reload();
                }}
              />
            )}
          </RuleDialog>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {rules.length === 0 && (
          <EmptyState>No context rules yet — every app folds as one activity.</EmptyState>
        )}
        {rules.length > 0 && (
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
                      <span className="flex items-center justify-end">
                        <RuleDialog
                          title="Edit context rule"
                          description="Saving replaces the rule. Activities already split by it keep the contexts they have; the new pattern applies from the next ping on."
                          trigger={<EditRuleButton label="context rule" />}
                        >
                          {(close) => (
                            <ContextRuleForm
                              samples={samples}
                              rule={rule}
                              onSaved={() => {
                                close();
                                reload();
                              }}
                            />
                          )}
                        </RuleDialog>
                        <ConfirmDelete
                          name="context rule"
                          description="Activities already split by this rule keep their contexts; new pings fold by app alone."
                          onConfirm={() => run(() => deleteContextRule(rule.id))}
                        />
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
