"use client";

import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CheckCircle2, LayoutGrid, ListTodo, Sparkles, Timer } from "lucide-react";

import { useProdStore } from "@/store/use-prod-store";

export default function DashboardPage() {
  const tasks = useProdStore((state) => state.tasks);
  const flashcards = useProdStore((state) => state.flashcards);

  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((task) => task.status === "Done").length;
  const totalPomodoros = tasks.reduce(
    (sum, task) => sum + task.pomodorosLogged,
    0
  );

  const chartData = tasks.map((task) => ({
    name: task.title,
    pomodoros: task.pomodorosLogged,
  }));

  const hasChartData = chartData.some((d) => d.pomodoros > 0);
  const recentFlashcards = flashcards.slice(-4);

  const metrics = [
    { label: "Total Tasks", value: totalTasks, icon: ListTodo },
    { label: "Completed Tasks", value: completedTasks, icon: CheckCircle2 },
    { label: "Total Pomodoros Logged", value: totalPomodoros, icon: Timer },
  ];

  return (
    <div className="px-8 py-10">
      <div className="mx-auto max-w-6xl">
        <header className="mb-10 text-center">
          <p className="font-heading text-xs font-medium tracking-[0.35em] text-[#b3a692] uppercase">
            Welcome to
          </p>
          <h1 className="mt-2 font-heading text-5xl font-semibold tracking-tight text-[#4a4036]">
            Cadence
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-[#9c8e7c]">
            A serene overview of your focus and progress.
          </p>
        </header>

        <div className="mb-8 grid gap-6 sm:grid-cols-3">
          {metrics.map(({ label, value, icon: Icon }) => (
            <div
              key={label}
              className="flex items-center gap-4 rounded-3xl border border-[#e8e0d5] bg-white p-6 shadow-[0_2px_8px_rgba(74,64,54,0.05)]"
            >
              <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#f7eee4] text-[#a35d4d]">
                <Icon className="size-6" />
              </div>
              <div>
                <p className="text-sm font-medium text-[#9c8e7c]">{label}</p>
                <p className="font-heading text-3xl font-semibold text-[#4a4036]">
                  {value}
                </p>
              </div>
            </div>
          ))}
        </div>

        <div className="mb-8 rounded-3xl border border-[#e8e0d5] bg-white p-8 shadow-[0_2px_8px_rgba(74,64,54,0.05)]">
          <h2 className="mb-6 font-heading text-xl font-semibold text-[#4a4036]">
            Pomodoros per Task
          </h2>
          {hasChartData ? (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartData}
                  margin={{ top: 8, right: 8, bottom: 8, left: -16 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0e7da" />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: "#9c8e7c", fontSize: 12 }}
                    tickFormatter={(name: string) =>
                      name.length > 14 ? `${name.slice(0, 14)}…` : name
                    }
                    interval={0}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fill: "#9c8e7c", fontSize: 12 }}
                  />
                  <Tooltip
                    cursor={{ fill: "#f7eee4" }}
                    contentStyle={{
                      borderRadius: "1rem",
                      border: "1px solid #e8e0d5",
                      color: "#4a4036",
                    }}
                  />
                  <Bar
                    dataKey="pomodoros"
                    fill="#a35d4d"
                    radius={[8, 8, 0, 0]}
                    maxBarSize={64}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex h-72 flex-col items-center justify-center text-center">
              <Timer className="mb-3 size-8 text-[#d8cab8]" />
              <p className="text-sm text-[#9c8e7c]">
                No pomodoros logged yet. Start a focus session to see your
                progress here.
              </p>
            </div>
          )}
        </div>

        <div className="rounded-3xl border border-[#e8e0d5] bg-white p-8 shadow-[0_2px_8px_rgba(74,64,54,0.05)]">
          {recentFlashcards.length > 0 ? (
            <>
              <h2 className="mb-6 font-heading text-xl font-semibold text-[#4a4036]">
                Recent Flashcards
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {recentFlashcards.map((card, index) => (
                  <div
                    key={index}
                    className="rounded-2xl border border-[#e8e0d5] bg-[#fdfbf7] p-5"
                  >
                    <p className="mb-1.5 text-sm font-semibold text-[#4a4036]">
                      {card.question}
                    </p>
                    <p className="text-sm text-[#6b5f50]">{card.answer}</p>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <h2 className="mb-6 font-heading text-xl font-semibold text-[#4a4036]">
                Quick Start
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <Link
                  href="/board"
                  className="flex items-center gap-4 rounded-2xl border border-[#e8e0d5] bg-[#fdfbf7] p-5 transition-colors hover:border-[#d8cab8] hover:bg-[#f7eee4]"
                >
                  <div className="flex size-10 items-center justify-center rounded-xl bg-[#f7eee4] text-[#a35d4d]">
                    <LayoutGrid className="size-5" />
                  </div>
                  <div>
                    <p className="font-medium text-[#4a4036]">Open the Board</p>
                    <p className="text-sm text-[#9c8e7c]">
                      Plan and track your tasks.
                    </p>
                  </div>
                </Link>
                <Link
                  href="/flashcards"
                  className="flex items-center gap-4 rounded-2xl border border-[#e8e0d5] bg-[#fdfbf7] p-5 transition-colors hover:border-[#d8cab8] hover:bg-[#f7eee4]"
                >
                  <div className="flex size-10 items-center justify-center rounded-xl bg-[#f7eee4] text-[#a35d4d]">
                    <Sparkles className="size-5" />
                  </div>
                  <div>
                    <p className="font-medium text-[#4a4036]">
                      Generate Flashcards
                    </p>
                    <p className="text-sm text-[#9c8e7c]">
                      Turn your notes into study cards.
                    </p>
                  </div>
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
