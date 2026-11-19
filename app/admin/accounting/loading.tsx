import {
  PageHeaderSkeleton,
  StatTilesSkeleton,
  TableSkeleton,
} from "@/components/skeletons";

export default function AccountingLoading() {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-4 sm:p-6">
      <PageHeaderSkeleton />
      <StatTilesSkeleton count={6} className="lg:grid-cols-3 xl:grid-cols-6" />
      <TableSkeleton rows={8} columns={7} />
    </div>
  );
}
