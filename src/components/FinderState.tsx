"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { apiGet, apiSend, errorMessage } from "@/components/api";
import type { FinderResult, LeadDTO } from "@/components/types";

type FinderState = {
  query: string; setQuery: (value: string) => void;
  location: string; setLocation: (value: string) => void;
  listName: string; setListName: (value: string) => void;
  resolve: boolean; setResolve: (value: boolean) => void;
  includeMaps: boolean; setIncludeMaps: (value: boolean) => void;
  searching: boolean; phase: number;
  result: FinderResult | null; leads: LeadDTO[]; error: string | null;
  saving: boolean; savedList: { id: string; name: string } | null; saveError: string | null;
  runSearch: () => Promise<void>; saveToList: () => Promise<void>;
};

const FinderContext = createContext<FinderState | null>(null);

export function FinderStateProvider({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("");
  const [listName, setListName] = useState("");
  const [resolve, setResolve] = useState(true);
  const [includeMaps, setIncludeMaps] = useState(false);
  const [searching, setSearching] = useState(false);
  const [phase, setPhase] = useState(0);
  const [result, setResult] = useState<FinderResult | null>(null);
  const [leads, setLeads] = useState<LeadDTO[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedList, setSavedList] = useState<{ id: string; name: string } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!searching) return;
    const timer = setInterval(() => setPhase((current) => Math.min(current + 1, 4)), 7000);
    return () => clearInterval(timer);
  }, [searching]);

  const runSearch = async () => {
    if (query.trim().length < 3 || searching) return;
    setSearching(true); setPhase(0); setError(null); setResult(null); setLeads([]); setSavedList(null); setSaveError(null);
    try {
      const response = await apiSend<FinderResult>("/api/finder", "POST", {
        query: query.trim(), ...(location.trim() ? { location: location.trim() } : {}), resolve, includeMaps,
      });
      setResult(response);
      const all = await apiGet<{ leads: LeadDTO[] }>("/api/leads?take=200&sort=score");
      const ids = new Set(response.leadIds ?? []);
      setLeads(all.leads.filter((lead) => ids.has(lead.id)));
    } catch (err) { setError(errorMessage(err)); }
    finally { setSearching(false); }
  };

  const saveToList = async () => {
    const name = listName.trim();
    if (!name) { setSaveError("Escribe un nombre para la lista antes de guardar."); return; }
    setSaving(true); setSaveError(null);
    try {
      const created = await apiSend<{ list: { id: string; name: string } }>("/api/lists", "POST", {
        name, description: `Generado con el AI Finder: ${query.trim()}`, icp: query.trim(),
      });
      const listId = created.list.id;
      await apiSend("/api/leads/assign-list", "POST", { leadIds: leads.map((lead) => lead.id), listId, add: true });
      setSavedList(created.list);
      setLeads((current) => current.map((lead) => ({ ...lead, listIds: Array.from(new Set([...lead.listIds, listId])) })));
    } catch (err) { setSaveError(errorMessage(err)); }
    finally { setSaving(false); }
  };

  const value = { query, setQuery, location, setLocation, listName, setListName, resolve, setResolve, includeMaps, setIncludeMaps, searching, phase, result, leads, error, saving, savedList, saveError, runSearch, saveToList };
  return <FinderContext.Provider value={value}>{children}</FinderContext.Provider>;
}

export function useFinderState() {
  const state = useContext(FinderContext);
  if (!state) throw new Error("useFinderState debe usarse dentro de FinderStateProvider");
  return state;
}
