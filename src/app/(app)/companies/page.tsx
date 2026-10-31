"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiGet, errorMessage } from "@/components/api";
import { Icon } from "@/components/icons";
import { formatDate } from "@/components/format";
import type { CompanyDTO } from "@/components/types";
import {
  Badge,
  Card,
  EmptyState,
  ErrorBox,
  Input,
  PageHeader,
  ScoreBadge,
  TableSkeleton,
} from "@/components/ui";

export default function CompaniesPage() {
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [companies, setCompanies] = useState<CompanyDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(queryInput), 400);
    return () => clearTimeout(timer);
  }, [queryInput]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiGet<{ companies: CompanyDTO[] }>(
        `/api/companies${query ? `?q=${encodeURIComponent(query)}` : ""}`,
      );
      setCompanies(response.companies ?? []);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Empresas"
        description="Los negocios que ha encontrado el agente, con su web, sector y contactos asociados."
      />

      <Card>
        <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="company-search">
          Buscar empresa
        </label>
        <div className="relative">
          <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400">
            <Icon name="search" className="h-4 w-4" />
          </span>
          <Input
            id="company-search"
            value={queryInput}
            onChange={setQueryInput}
            placeholder="Nombre o dominio"
            className="pl-9"
          />
        </div>
      </Card>

      {error ? <ErrorBox message={error} onRetry={() => void load()} /> : null}

      <Card padded={false}>
        {loading ? (
          <TableSkeleton rows={8} columns={6} />
        ) : companies.length === 0 ? (
          <div className="p-5">
            <EmptyState
              title="No hay empresas registradas"
              description={
                query
                  ? "Ninguna empresa coincide con la búsqueda."
                  : "Las empresas aparecen cuando el AI Finder descubre negocios reales."
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs tracking-wide text-slate-500 uppercase">
                  <th className="px-3 py-2 font-medium">Empresa</th>
                  <th className="px-3 py-2 font-medium">Sector</th>
                  <th className="px-3 py-2 font-medium">Ubicación</th>
                  <th className="px-3 py-2 font-medium">Teléfono</th>
                  <th className="px-3 py-2 font-medium">Leads</th>
                  <th className="px-3 py-2 font-medium">Score medio</th>
                  <th className="px-3 py-2 font-medium">Añadida</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {companies.map((company) => (
                  <tr key={company.id} className="hover:bg-slate-50/70">
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-slate-900">{company.name}</div>
                      {company.website ? (
                        <a
                          href={company.website}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800"
                        >
                          {company.domain ?? company.website}
                          <Icon name="external" className="h-3 w-3" />
                        </a>
                      ) : (
                        <div className="text-xs text-slate-400">Sin web</div>
                      )}
                      {company.tags.length > 0 ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {company.tags.slice(0, 3).map((tag) => (
                            <Badge key={tag} tone="slate">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">{company.industry || "—"}</td>
                    <td className="px-3 py-2.5 text-slate-600">
                      {[company.city, company.region].filter(Boolean).join(", ") || "—"}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">{company.phoneNumber || "—"}</td>
                    <td className="px-3 py-2.5">
                      <Link
                        href={`/leads?companyId=${encodeURIComponent(company.id)}`}
                        className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
                      >
                        {company.leadCount}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5">
                      <ScoreBadge score={company.score} />
                    </td>
                    <td className="px-3 py-2.5 text-xs whitespace-nowrap text-slate-500">
                      {formatDate(company.createdAt)}
                    </td>
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
