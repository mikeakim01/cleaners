"use client";

import { use } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useDashboard } from "@/hooks/useDashboard";
import { useTenant } from "@/hooks/useTenants";

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-zinc-100 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-zinc-500">{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-xl bg-zinc-100 ${className}`} />;
}

export default function DashboardPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = use(params);
  const tenantQuery = useTenant(tenantSlug);
  const tenantId = (tenantQuery.data?.tenant as { id?: string } | undefined)?.id ?? "";
  const dash = useDashboard(tenantId);

  if (tenantQuery.isPending) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
      </div>
    );
  }

  if (tenantQuery.isError) {
    return (
      <div role="alert" className="rounded-2xl bg-red-50 p-6 text-sm text-red-700">
        Could not load this business: {(tenantQuery.error as Error).message}
      </div>
    );
  }

  const kpis = [
    { label: "Today's bookings", value: dash.data?.kpis.todayBookings },
    { label: "Upcoming jobs", value: dash.data?.kpis.upcomingJobs },
    { label: "Revenue (TZS)", value: dash.data?.kpis.revenueThisMonth?.toLocaleString() },
    { label: "Pending payments", value: dash.data?.kpis.pendingPayments },
    { label: "Completed jobs", value: dash.data?.kpis.completedJobs },
    { label: "New customers", value: dash.data?.kpis.newCustomers },
  ];

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold tracking-tight">Dashboard</h1>

      {dash.isError && (
        <div role="alert" className="rounded-2xl bg-red-50 p-4 text-sm text-red-700">
          Could not load dashboard figures: {(dash.error as Error).message}
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {kpis.map((k) => (
          <Card key={k.label} title={k.label}>
            {dash.isPending ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <p className="text-2xl font-bold">{k.value ?? 0}</p>
            )}
          </Card>
        ))}
      </div>

      {/* Revenue trend */}
      <Card title="Revenue trend">
        {dash.isPending ? (
          <Skeleton className="h-48" />
        ) : !dash.data || dash.data.revenue.length === 0 ? (
          <p className="py-8 text-center text-sm text-zinc-500">
            No revenue yet. Your earnings chart will appear after your first paid job.
          </p>
        ) : (
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dash.data.revenue}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Area type="monotone" dataKey="revenue" fill="#0d7a5f" fillOpacity={0.2} stroke="#0d7a5f" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Today schedule */}
        <Card title="Today's schedule">
          {dash.isPending ? (
            <Skeleton className="h-20" />
          ) : !dash.data || dash.data.bookings.length === 0 ? (
            <p className="py-6 text-center text-sm text-zinc-500">Nothing scheduled today. New bookings will show up here.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {dash.data.bookings.slice(0, 5).map((b) => (
                <li key={b.id} className="flex items-center justify-between rounded-xl bg-zinc-50 px-3 py-2 text-sm">
                  <span className="font-medium">{b.customer} · {b.service}</span>
                  <span className="text-xs text-zinc-500">{b.status}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* WhatsApp */}
        <Card title="WhatsApp enquiries">
          {dash.isPending ? (
            <Skeleton className="h-20" />
          ) : (dash.data?.whatsapp ?? 0) === 0 ? (
            <p className="py-6 text-center text-sm text-zinc-500">
              No WhatsApp chats yet. Connect WhatsApp in onboarding step 7 (Phase 4) to receive enquiries here.
            </p>
          ) : (
            <p className="text-2xl font-bold">{dash.data?.whatsapp}</p>
          )}
        </Card>
      </div>

      {/* Recent bookings */}
      <Card title="Recent bookings">
        {dash.isPending ? (
          <Skeleton className="h-32" />
        ) : !dash.data || dash.data.bookings.length === 0 ? (
          <p className="py-6 text-center text-sm text-zinc-500">No bookings yet. Share your booking link to get started.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-105 text-left text-sm">
              <thead>
                <tr className="text-xs text-zinc-500">
                  <th className="py-2 pr-3 font-medium">Customer</th>
                  <th className="py-2 pr-3 font-medium">Service</th>
                  <th className="py-2 pr-3 font-medium">Date</th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {dash.data.bookings.map((b) => (
                  <tr key={b.id} className="border-t border-zinc-100">
                    <td className="py-2 pr-3 font-medium">{b.customer}</td>
                    <td className="py-2 pr-3 text-zinc-600">{b.service}</td>
                    <td className="py-2 pr-3 text-zinc-600">{b.date}</td>
                    <td className="py-2"><span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs">{b.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
