/**
 * Family "segmented tabs" look for the shadcn Tabs (tobi-ui-theme): a raised track, the active
 * tab lifted onto the card surface with a line inset. Pass to TabsList / TabsTrigger.
 */
export const segmentedList =
  "h-auto! max-w-full justify-start gap-0.5 overflow-x-auto rounded-xl bg-secondary p-1";

export const segmentedTrigger =
  "h-auto flex-none gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors duration-150 data-active:bg-card data-active:text-foreground data-active:shadow-[inset_0_0_0_1px_var(--border)] dark:data-active:border-transparent dark:data-active:bg-card [&_svg]:size-4 data-active:[&_svg]:text-primary";
