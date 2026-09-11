'use client';
/* MangaFire already serves purpose-sized CDN thumbnails; proxying them through Next would add avoidable bandwidth. */
/* eslint-disable @next/next/no-img-element */

import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { getMangaFireChapters, getMangaFireDetails, getMangaFirePages, listMangaFireTitles } from '@/lib/sources/mangafire';

type View = 'library' | 'updates' | 'browse' | 'history' | 'duplicates' | 'details' | 'reader';
type Manga = { id: string; title: string; source: string; sourceUrl?: string; source_url?: string; coverUrl?: string; cover_url?: string; latestChapter?: number; latest_chapter_number?: number; category: string; categories?: string[]; chapters: number; unread: number; progress: number; color: string; lastRead?: number; last_read_at?: number; lastPage?: number; page_index?: number; lastChapterId?: string; source_chapter_id?: string; lastChapterNumber?: number; chapter_number?: number };
type BackupTitle = { title?: string; source?: string; favorite?: boolean; category?: string | string[]; chapterCount?: number; unread?: number; lastChapterRead?: number };
type DuplicateGroup = { id: string; reason: 'Same provider entry' | 'Same title'; confidence: 'strong' | 'review'; items: Manga[] };
type SourceTitle = { hid: string; slug?: string; title: string; type?: string; status?: string; latestChapter?: number; poster?: { small?: string; medium?: string; large?: string } };
type SourceDetails = SourceTitle & { synopsisHtml?: string; authors?: Array<{ title: string }>; artists?: Array<{ title: string }>; genres?: Array<{ title: string }>; themes?: Array<{ title: string }> };
type SourceChapter = { id: number; number: number; name?: string; createdAt?: number; type?: string };

const seed: Manga[] = [
  { id: 'hikaru', title: 'The Summer Hikaru Died', source: 'MangaDex', category: 'Reading', chapters: 38, unread: 2, progress: 72, color: 'coral', lastRead: Date.now() - 1000 * 60 * 14 },
  { id: 'frieren', title: "Frieren: Beyond Journey's End", source: 'MangaDex', category: 'Reading', chapters: 145, unread: 1, progress: 48, color: 'blue', lastRead: Date.now() - 1000 * 60 * 60 * 3 },
  { id: 'apothecary', title: 'The Apothecary Diaries', source: 'MangaFire', category: 'Manhwa', chapters: 82, unread: 0, progress: 35, color: 'gold' },
  { id: 'witch', title: 'Witch Hat Atelier', source: 'MangaDex', category: 'Reading', chapters: 91, unread: 0, progress: 18, color: 'green', lastRead: Date.now() - 1000 * 60 * 60 * 24 },
];
const defaultCategories = ['Unread', 'Reading', 'Manhwa', 'Completed', 'Plan to read', 'Others', 'All'];
const availableSources = ['MangaFire', 'MangaDex', 'Asura Scans', 'MangaReader.to'];

function orderedCategories(names: string[]) {
  const canonical = names.map(displayCategory).filter(name => name && name !== 'All');
  return ['Unread', ...new Set(canonical.filter(name => name !== 'Unread' && name !== 'Others')), 'Others', 'All'];
}

function displayCategory(name: string) {
  const cleaned = name.trim();
  if (cleaned.toLowerCase() === 'unread') return 'Unread';
  if (cleaned.toLowerCase() === 'all') return 'All';
  if (cleaned.toLowerCase() === 'uncategorized' || cleaned.toLowerCase() === 'others') return 'Others';
  return cleaned;
}

function belongsToCategory(manga: Manga, category: string) {
  const wanted = displayCategory(category).toLowerCase();
  return (manga.categories ?? [manga.category]).some(name => displayCategory(name).toLowerCase() === wanted);
}

function shortTitle(title: string, limit = 42) {
  return title.length > limit ? `${title.slice(0, limit - 1).trimEnd()}…` : title;
}

function relativeTime(timestamp?: number) {
  if (!timestamp) return 'Not started';
  const minutes = Math.max(1, Math.floor((Date.now() - timestamp) / 60000));
  return minutes < 60 ? `${minutes} min ago` : minutes < 1440 ? `${Math.floor(minutes / 60)} hr ago` : `${Math.floor(minutes / 1440)} days ago`;
}

function normaliseRemoteLibrary(remote: Manga[]) {
  return remote.map((item, index) => ({ ...item, sourceUrl: item.sourceUrl ?? item.source_url, coverUrl: item.coverUrl ?? item.cover_url, latestChapter: item.latestChapter ?? item.latest_chapter_number, categories: (item.categories?.length ? item.categories : [item.category]).map(displayCategory), chapters: Number(item.chapters) || 0, unread: Number(item.unread) || 0, progress: Number(item.progress) || 0, lastRead: item.last_read_at ? Number(item.last_read_at) * 1000 : item.lastRead, lastPage: Number(item.page_index ?? item.lastPage) || 0, lastChapterId: item.source_chapter_id ?? item.lastChapterId, lastChapterNumber: Number(item.chapter_number ?? item.lastChapterNumber) || undefined, color: ['coral', 'blue', 'gold', 'green'][index % 4] }));
}

function mangaFireHid(manga: Manga) {
  const sourceUrl = manga.sourceUrl ?? (manga.id.startsWith('mihon:') ? manga.id.slice(manga.id.indexOf(':', 6) + 1) : '');
  const lastPart = sourceUrl.replace(/\/$/, '').split('/').pop() ?? '';
  if (lastPart.includes('.')) return lastPart.split('.').pop() ?? '';
  if (lastPart.includes('-')) return lastPart.split('-')[0];
  return lastPart || (manga.id.startsWith('source:mangafire:') ? manga.id.slice('source:mangafire:'.length) : '');
}

function normaliseDuplicateGroups(groups: DuplicateGroup[]) {
  return groups.map((group, groupIndex) => ({ ...group, items: group.items.map((item, itemIndex) => ({ ...item, color: ['coral', 'blue', 'gold', 'green'][(groupIndex + itemIndex) % 4] })) }));
}

function normaliseBackup(raw: unknown): Manga[] {
  const data = raw as { mangas?: BackupTitle[]; backupManga?: BackupTitle[] };
  const titles = Array.isArray(raw) ? raw as BackupTitle[] : data.mangas ?? data.backupManga ?? [];
  return titles.filter(item => item.favorite !== false && item.title).map((item, index) => {
    const category = Array.isArray(item.category) ? item.category[0] : item.category;
    const chapters = Number(item.chapterCount) || 0;
    const categoryName = category || 'Reading'; return { id: `import-${Date.now()}-${index}`, title: item.title!.trim(), source: item.source || 'Imported source', category: categoryName, categories: [categoryName], chapters, unread: Number(item.unread) || 0, progress: Math.min(100, Math.round(((Number(item.lastChapterRead) || 0) / Math.max(chapters, 1)) * 100)), color: ['coral', 'blue', 'gold', 'green'][index % 4] };
  });
}

type ProtoValue = Uint8Array | bigint | number;
type ProtoMessage = Map<number, ProtoValue[]>;
function readProto(bytes: Uint8Array): ProtoMessage {
  const fields: ProtoMessage = new Map(); let cursor = 0; const zero = BigInt(0);
  const varint = () => { let value = zero; let shift = zero; while (cursor < bytes.length) { const byte = bytes[cursor++]; value |= BigInt(byte & 127) << shift; if (!(byte & 128)) return value; shift += BigInt(7); } throw new Error('Invalid Protocol Buffer data.'); };
  while (cursor < bytes.length) { const tag = varint(); const field = Number(tag >> BigInt(3)); const wire = Number(tag & BigInt(7)); let value: ProtoValue; if (wire === 0) value = varint(); else if (wire === 2) { const length = Number(varint()); value = bytes.slice(cursor, cursor + length); cursor += length; } else if (wire === 5) { value = new DataView(bytes.buffer, bytes.byteOffset + cursor, 4).getFloat32(0, true); cursor += 4; } else if (wire === 1) { cursor += 8; continue; } else throw new Error('Unsupported Protocol Buffer field.'); fields.set(field, [...(fields.get(field) ?? []), value]); }
  return fields;
}
const textField = (message: ProtoMessage, field: number) => { const value = message.get(field)?.[0]; return value instanceof Uint8Array ? new TextDecoder().decode(value) : ''; };
const numberField = (message: ProtoMessage, field: number) => { const value = message.get(field)?.[0]; return typeof value === 'bigint' ? value : BigInt(0); };
const floatField = (message: ProtoMessage, field: number) => { const value = message.get(field)?.[0]; return typeof value === 'number' ? value : Number.NaN; };
async function decodeMihonBackup(file: File): Promise<Manga[]> {
  const compressed = new Uint8Array(await file.arrayBuffer());
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
  const root = readProto(new Uint8Array(await new Response(stream).arrayBuffer()));
  const categoryNames = new Map((root.get(2) ?? []).filter((v): v is Uint8Array => v instanceof Uint8Array).map(v => { const category = readProto(v); return [numberField(category, 2).toString(), textField(category, 1)]; }));
  const sourceNames = new Map((root.get(101) ?? []).filter((v): v is Uint8Array => v instanceof Uint8Array).map(v => { const source = readProto(v); return [numberField(source, 2).toString(), textField(source, 1)]; }));
  return (root.get(1) ?? []).filter((v): v is Uint8Array => v instanceof Uint8Array).map((value, index) => { const manga = readProto(value); const rawChapters = (manga.get(16) ?? []).filter((v): v is Uint8Array => v instanceof Uint8Array).map(readProto); const uniqueChapters = new Map<number | string, ProtoMessage>(); for (const chapter of rawChapters) { const number = floatField(chapter, 9); const key = Number.isFinite(number) ? number : textField(chapter, 2).trim().toLowerCase(); const existing = uniqueChapters.get(key); const official = textField(chapter, 3).trim().toLowerCase() === 'official'; if (!existing || (official && textField(existing, 3).trim().toLowerCase() !== 'official')) uniqueChapters.set(key, chapter); } const chapters = [...uniqueChapters.values()]; const read = chapters.filter(chapter => numberField(chapter, 4) !== BigInt(0)).length; const categories = (manga.get(17) ?? []).filter((v): v is bigint => typeof v === 'bigint').map(id => categoryNames.get(id.toString())).filter((name): name is string => Boolean(name)); const category = categories[0] || 'Others'; const sourceUrl = textField(manga, 2); return { id: `mihon:${numberField(manga, 1)}:${sourceUrl}`, title: textField(manga, 3), source: sourceNames.get(numberField(manga, 1).toString()) || 'Imported source', sourceUrl, category, categories: categories.length ? categories : [category], chapters: chapters.length, unread: Math.max(0, chapters.length - read), progress: chapters.length ? Math.round((read / chapters.length) * 100) : 0, color: ['coral', 'blue', 'gold', 'green'][index % 4] }; }).filter(manga => manga.title);
}

async function loadMangaFireList(mode: 'popular' | 'latest' | 'search', query: string) {
  const parameters = new URLSearchParams({ action: mode, page: '1' });
  if (mode === 'search') parameters.set('q', query.trim());
  try {
    const response = await fetch(`/api/sources/mangafire?${parameters}`);
    const data = await response.json() as { items?: SourceTitle[]; error?: string };
    if (!response.ok) throw new Error(data.error || 'MangaFire is unavailable from Mori.');
    return { items: data.items ?? [], usedDevice: false };
  } catch {
    try {
      const direct = await listMangaFireTitles({ type: mode, query: query.trim() || undefined, page: 1 });
      return { items: direct.items ?? [], usedDevice: true };
    } catch {
      throw new Error('MangaFire blocked both Mori\'s server and this device. Try again later or use MangaDex.');
    }
  }
}

async function loadMangaFireTitle(hid: string) {
  try {
    const response = await fetch(`/api/sources/mangafire?action=details&hid=${encodeURIComponent(hid)}`);
    const data = await response.json() as { details?: SourceDetails; chapters?: SourceChapter[]; error?: string };
    if (!response.ok || !data.details) throw new Error(data.error || 'Could not load manga details from Mori.');
    return { manga: data.details, chapters: data.chapters ?? [], usedDevice: false };
  } catch {
    try {
      const [manga, chapters] = await Promise.all([getMangaFireDetails(hid), getMangaFireChapters(hid)]);
      return { manga, chapters, usedDevice: true };
    } catch {
      throw new Error('MangaFire blocked both Mori\'s server and this device. Try again later or use MangaDex.');
    }
  }
}

async function loadMangaFirePages(chapterId: number) {
  try {
    const response = await fetch(`/api/sources/mangafire?action=pages&chapterId=${chapterId}`);
    const data = await response.json() as { pages?: Array<{ url: string }>; error?: string };
    if (!response.ok) throw new Error(data.error || 'Could not load chapter pages from Mori.');
    return data.pages ?? [];
  } catch {
    try {
      return await getMangaFirePages(chapterId);
    } catch {
      throw new Error('MangaFire blocked the chapter pages. Try again later.');
    }
  }
}

async function refreshMangaFireBatch(batch: Array<{ id: string; hid: string }>) {
  let updates: Array<{ id: string; latestChapter: number }> = [];
  let pending = batch;
  try {
    const response = await fetch('/api/sources/mangafire', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entries: batch }) });
    const data = await response.json() as { updates?: Array<{ id: string; latestChapter: number }>; errors?: Array<{ id: string }> };
    if (response.ok) {
      updates = data.updates ?? [];
      const failedIds = new Set((data.errors ?? []).map(error => error.id));
      pending = batch.filter(entry => failedIds.has(entry.id));
    }
  } catch {}

  const failed: string[] = [];
  for (const entry of pending) {
    try {
      const details = await getMangaFireDetails(entry.hid);
      if (Number.isFinite(details.latestChapter)) updates.push({ id: entry.id, latestChapter: Number(details.latestChapter) });
      else failed.push(entry.id);
    } catch {
      failed.push(entry.id);
    }
  }
  return { updates, failed };
}

function Cover({ manga, onClick }: { manga: Manga; onClick: () => void }) {
  return <button className={`cover ${manga.color}`} onClick={onClick} aria-label={`Read ${manga.title}`}>{manga.coverUrl ? <img src={manga.coverUrl} alt=""/> : manga.title.split(' ').slice(0, 2).map(word => word[0]).join('')}</button>;
}

export default function Home() {
  const [library, setLibrary] = useState<Manga[]>(seed); const [categories, setCategories] = useState(defaultCategories); const [sources, setSources] = useState(['MangaFire', 'MangaDex']);
  const [view, setView] = useState<View>('library'); const [previousView, setPreviousView] = useState<View>('library'); const [category, setCategory] = useState('Unread'); const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('Library is stored on this device. Import your Mihon backup to begin.'); const [selected, setSelected] = useState<Manga | null>(null); const [theme, setTheme] = useState<'light' | 'dark'>('light'); const [authenticated, setAuthenticated] = useState<boolean | null>(null); const [password, setPassword] = useState(''); const [authError, setAuthError] = useState(''); const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([]); const [duplicatesLoading, setDuplicatesLoading] = useState(false); const [mergingGroup, setMergingGroup] = useState<string | null>(null); const [sourceMode, setSourceMode] = useState<'popular' | 'latest' | 'search'>('popular'); const [sourceQuery, setSourceQuery] = useState(''); const [sourceResults, setSourceResults] = useState<SourceTitle[]>([]); const [sourceLoading, setSourceLoading] = useState(false); const [refreshing, setRefreshing] = useState(false); const [sourceDetails, setSourceDetails] = useState<{ manga: SourceDetails; chapters: SourceChapter[] } | null>(null); const [selectedChapters, setSelectedChapters] = useState<SourceChapter[]>([]); const [chapterLoading, setChapterLoading] = useState(false); const [readerChapter, setReaderChapter] = useState<SourceChapter | null>(null); const [readerPages, setReaderPages] = useState<string[]>([]); const [readerPage, setReaderPage] = useState(0); const [readerControls, setReaderControls] = useState(true); const fileInput = useRef<HTMLInputElement>(null); const readerHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revealReaderControls = () => { setReaderControls(true); if (readerHideTimer.current) clearTimeout(readerHideTimer.current); readerHideTimer.current = setTimeout(() => setReaderControls(false), 2600); };
  const saveReaderProgress = (manga: Manga, chapter: SourceChapter, pageIndex: number, pageCount: number, unread = manga.unread) => { const progress = pageCount ? Math.round(((pageIndex + 1) / pageCount) * 100) : 0; void fetch('/api/library', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mangaId: manga.id, progress, unread, pageIndex, sourceChapterId: String(chapter.id), chapterNumber: chapter.number }) }); };
  useEffect(() => { const saved = localStorage.getItem('mori-library'); const c = localStorage.getItem('mori-categories'); const s = localStorage.getItem('mori-sources'); const restore = window.setTimeout(() => { if (saved) try { setLibrary(JSON.parse(saved)); } catch {} if (c) setCategories(orderedCategories(JSON.parse(c))); if (s) setSources(JSON.parse(s)); }, 0); return () => window.clearTimeout(restore); }, []);
  useEffect(() => { const savedTheme = localStorage.getItem('mori-theme') === 'dark' ? 'dark' : 'light'; document.documentElement.dataset.theme = savedTheme; const restore = window.setTimeout(() => setTheme(savedTheme), 0); return () => window.clearTimeout(restore); }, []);
  useEffect(() => { fetch('/api/session').then(response => response.json()).then(data => setAuthenticated((data as { authenticated?: boolean }).authenticated === true)).catch(() => setAuthenticated(false)); }, []);
  useEffect(() => { if (!authenticated) return; fetch('/api/library').then(response => response.ok ? response.json() : Promise.reject()).then(data => { const normalised = normaliseRemoteLibrary((data as { manga?: Manga[] }).manga ?? []); setLibrary(normalised); setCategories(orderedCategories(normalised.flatMap(item => item.categories ?? [item.category]))); setNotice(normalised.length ? 'Cloud library loaded.' : 'Your cloud library is empty. Import your Mihon backup to begin.'); }).catch(() => setNotice('Cloud library is unavailable; using this device copy.')); fetch('/api/library/duplicates').then(response => response.ok ? response.json() : Promise.reject()).then(data => setDuplicateGroups(normaliseDuplicateGroups((data as { groups?: DuplicateGroup[] }).groups ?? []))).catch(() => {}); }, [authenticated]);
  useEffect(() => { localStorage.setItem('mori-library', JSON.stringify(library)); }, [library]); useEffect(() => { localStorage.setItem('mori-categories', JSON.stringify(categories)); }, [categories]); useEffect(() => { localStorage.setItem('mori-sources', JSON.stringify(sources)); }, [sources]);
  useEffect(() => {
    if (!sourceDetails) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setSourceDetails(null); };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener('keydown', closeOnEscape); };
  }, [sourceDetails]);
  useEffect(() => {
    if (view !== 'reader') return;
    if (readerHideTimer.current) clearTimeout(readerHideTimer.current);
    readerHideTimer.current = setTimeout(() => setReaderControls(false), 2600);
    return () => { if (readerHideTimer.current) clearTimeout(readerHideTimer.current); };
  }, [view, readerChapter?.id]);
  useEffect(() => {
    if (view !== 'reader' || !selected || !readerChapter || !readerPages.length) return;
    const observer = new IntersectionObserver(entries => { const visible = entries.filter(entry => entry.isIntersecting).sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0]; if (!visible) return; const page = Number((visible.target as HTMLElement).dataset.page); if (!Number.isFinite(page)) return; const progress = { lastRead: Date.now(), lastPage: page, lastChapterId: String(readerChapter.id), lastChapterNumber: readerChapter.number }; setReaderPage(page); setLibrary(items => items.map(item => item.id === selected.id ? { ...item, ...progress } : item)); setSelected(current => current?.id === selected.id ? { ...current, ...progress } : current); saveReaderProgress(selected, readerChapter, page, readerPages.length); }, { threshold: [0.35, 0.6] });
    document.querySelectorAll<HTMLElement>('.reader-image').forEach(element => observer.observe(element));
    return () => observer.disconnect();
  // Page changes are emitted by IntersectionObserver and should not recreate it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, selected?.id, readerChapter?.id, readerPages.length]);
  const filtered = useMemo(() => library
    .filter(item => (category === 'All' || belongsToCategory(item, category)) && item.title.toLowerCase().includes(query.toLowerCase()))
    .sort((left, right) => left.unread - right.unread || left.title.localeCompare(right.title)), [library, category, query]);
  const unread = library.reduce((total, item) => total + item.unread, 0); const history = [...library].filter(item => item.lastRead).sort((a, b) => (b.lastRead ?? 0) - (a.lastRead ?? 0));
  const open = (next: Exclude<View, 'reader'>) => { setQuery(''); setView(next); };
  const handleNavigation = (next: Exclude<View, 'reader' | 'details'>, clickCount = 1) => { if (next === 'history' && clickCount > 1 && history[0]) { resumeManga(history[0]); return; } open(next); };
  const toggleTheme = () => { const next = theme === 'light' ? 'dark' : 'light'; setTheme(next); document.documentElement.dataset.theme = next; localStorage.setItem('mori-theme', next); };
  const openChapter = async (manga: Manga, chapter: SourceChapter, resumePage = 0) => { if (manga.source.toLowerCase() !== 'mangafire' || chapter.id <= 0) { setNotice(`${manga.source} reading will be available when that source adapter is connected.`); return; } setChapterLoading(true); try { const pages = await loadMangaFirePages(chapter.id); if (!pages.length) throw new Error('This chapter returned no readable pages.'); const page = Math.min(Math.max(0, resumePage), pages.length - 1); setPreviousView('details'); setSelected(manga); setReaderChapter(chapter); setReaderPages(pages.map(item => item.url)); setReaderPage(page); setReaderControls(true); setLibrary(items => items.map(item => item.id === manga.id ? { ...item, lastRead: Date.now(), lastPage: page, lastChapterId: String(chapter.id), lastChapterNumber: chapter.number } : item)); saveReaderProgress(manga, chapter, page, pages.length); setView('reader'); window.setTimeout(() => document.getElementById(`reader-page-${page}`)?.scrollIntoView(), 0); } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not open this chapter.'); } finally { setChapterLoading(false); } };
  const openMangaDetails = async (manga: Manga, resume = false) => { setPreviousView(view); setSelected(manga); setSelectedChapters([]); setChapterLoading(true); setView('details'); try { let chapters: SourceChapter[] = []; if (manga.source.toLowerCase() === 'mangafire' && mangaFireHid(manga)) chapters = (await loadMangaFireTitle(mangaFireHid(manga))).chapters; else chapters = Array.from({ length: manga.chapters }, (_, index) => ({ id: -(index + 1), number: manga.chapters - index, name: `Chapter ${manga.chapters - index}` })); setSelectedChapters(chapters); let currentManga = manga; if (chapters.length !== manga.chapters) { const readCount = Math.max(0, manga.chapters - manga.unread); const correctedUnread = Math.max(0, chapters.length - readCount); currentManga = { ...manga, chapters: chapters.length, unread: correctedUnread }; setLibrary(items => items.map(item => item.id === manga.id ? currentManga : item)); setSelected(current => current?.id === manga.id ? currentManga : current); void fetch('/api/library/manage', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mangaId: manga.id, chapterCount: chapters.length, unread: correctedUnread }) }); } if (resume && chapters.length) { const chapter = chapters.find(item => String(item.id) === currentManga.lastChapterId) ?? chapters[Math.min(Math.max(currentManga.unread - 1, 0), chapters.length - 1)]; await openChapter(currentManga, chapter, currentManga.lastChapterId === String(chapter.id) ? currentManga.lastPage ?? 0 : 0); } } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not load chapters.'); } finally { setChapterLoading(false); } };
  const resumeManga = (manga: Manga) => { void openMangaDetails(manga, true); };
  const jumpToPage = (page: number) => { const bounded = Math.min(Math.max(0, page), Math.max(0, readerPages.length - 1)); setReaderPage(bounded); document.getElementById(`reader-page-${bounded}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); revealReaderControls(); };
  const markRead = () => { if (!selected || !readerChapter) return; const unread = Math.max(0, selected.unread - 1); saveReaderProgress(selected, readerChapter, readerPage, readerPages.length, unread); setLibrary(items => items.map(item => item.id === selected.id ? { ...item, unread, lastRead: Date.now(), lastPage: readerPage, lastChapterId: String(readerChapter.id), lastChapterNumber: readerChapter.number } : item)); setSelected(current => current ? { ...current, unread } : current); };
  const changeMangaCategory = async (manga: Manga, nextCategory: string) => { const response = await fetch('/api/library/manage', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mangaId: manga.id, categories: [nextCategory] }) }); const data = await response.json() as { error?: string }; if (!response.ok) { setNotice(data.error || 'Could not change category.'); return; } setLibrary(items => items.map(item => item.id === manga.id ? { ...item, category: nextCategory, categories: [nextCategory] } : item)); setSelected(current => current?.id === manga.id ? { ...current, category: nextCategory, categories: [nextCategory] } : current); setCategories(current => orderedCategories([...current, nextCategory])); setNotice(`${manga.title} moved to ${nextCategory}.`); };
  const removeFromLibrary = async (manga: Manga) => { if (!window.confirm(`Remove “${manga.title}” from your library? Reading history will be kept.`)) return; const response = await fetch('/api/library/manage', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mangaId: manga.id }) }); const data = await response.json() as { error?: string }; if (!response.ok) { setNotice(data.error || 'Could not remove title.'); return; } setLibrary(items => items.filter(item => item.id !== manga.id)); setSelected(null); setView('library'); setNotice(`${manga.title} removed from the library.`); };
  const checkUpdates = async () => {
    if (refreshing) return;
    if (!sources.includes('MangaFire')) { setNotice('Select MangaFire in Browse before refreshing.'); setView('browse'); return; }
    const entries = library.filter(manga => manga.source === 'MangaFire').map(manga => ({ id: manga.id, hid: mangaFireHid(manga) })).filter(entry => entry.hid);
    if (!entries.length) { setNotice('No MangaFire library entries can be matched yet.'); return; }
    setRefreshing(true);
    setView('updates');
    let checked = 0; let found = 0; let failed = 0;
    try {
      for (let index = 0; index < entries.length; index += 5) {
        const batch = entries.slice(index, index + 5);
        setNotice(`Refreshing MangaFire… ${checked}/${entries.length}`);
        const sourceData = await refreshMangaFireBatch(batch);
        failed += sourceData.failed.length;
        if (sourceData.updates.length) {
          const saveResponse = await fetch('/api/library/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ updates: sourceData.updates }) });
          const saved = await saveResponse.json() as { updates?: Array<{ id: string; latestChapter: number; delta: number; chapters: number; unread: number }>; error?: string };
          if (!saveResponse.ok) throw new Error(saved.error || 'Could not save source updates.');
          found += saved.updates?.reduce((total, update) => total + update.delta, 0) ?? 0;
          if (saved.updates?.length) setLibrary(current => current.map(manga => { const update = saved.updates?.find(item => item.id === manga.id); return update ? { ...manga, latestChapter: update.latestChapter, chapters: update.chapters, unread: update.unread } : manga; }));
        }
        checked += batch.length;
      }
      setNotice(`MangaFire refresh complete: checked ${checked}, found ${found} new chapter${found === 1 ? '' : 's'}${failed ? `, ${failed} failed` : ''}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Refresh failed.');
    } finally {
      setRefreshing(false);
    }
  };
  const addCategory = () => { const name = prompt('Category name'); if (name?.trim() && !categories.includes(name.trim())) setCategories(current => orderedCategories([...current, name.trim()])); };
  const reviewDuplicates = async () => { setView('duplicates'); setDuplicatesLoading(true); try { const response = await fetch('/api/library/duplicates'); if (!response.ok) throw new Error(); const data = await response.json() as { groups?: DuplicateGroup[] }; setDuplicateGroups(normaliseDuplicateGroups(data.groups ?? [])); } catch { setNotice('Could not load duplicate candidates.'); } finally { setDuplicatesLoading(false); } };
  const mergeDuplicateGroup = async (group: DuplicateGroup, canonical: Manga) => { const duplicateIds = group.items.filter(item => item.id !== canonical.id).map(item => item.id); if (!window.confirm(`Keep “${canonical.title}” from ${canonical.source} and merge ${duplicateIds.length} other entr${duplicateIds.length === 1 ? 'y' : 'ies'} into it?`)) return; setMergingGroup(group.id); try { const response = await fetch('/api/library/duplicates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ canonicalId: canonical.id, duplicateIds }) }); if (!response.ok) { const data = await response.json() as { error?: string }; throw new Error(data.error || 'Merge failed.'); } const [libraryResponse, duplicatesResponse] = await Promise.all([fetch('/api/library'), fetch('/api/library/duplicates')]); if (!libraryResponse.ok || !duplicatesResponse.ok) throw new Error('Merge completed, but refreshing the library failed.'); const normalised = normaliseRemoteLibrary(((await libraryResponse.json()) as { manga?: Manga[] }).manga ?? []); setLibrary(normalised); setCategories(orderedCategories(normalised.flatMap(item => item.categories ?? [item.category]))); setDuplicateGroups(normaliseDuplicateGroups(((await duplicatesResponse.json()) as { groups?: DuplicateGroup[] }).groups ?? [])); setNotice(`Merged ${duplicateIds.length + 1} entries. Kept ${canonical.title} from ${canonical.source}.`); } catch (error) { setNotice(error instanceof Error ? error.message : 'Merge failed.'); } finally { setMergingGroup(null); } };
  const browseMangaFire = async (mode: 'popular' | 'latest' | 'search' = sourceMode) => { if (mode === 'search' && !sourceQuery.trim()) return; setSourceMode(mode); setSourceLoading(true); setSourceDetails(null); try { const result = await loadMangaFireList(mode, sourceQuery); setSourceResults(result.items); setNotice(`Loaded ${result.items.length} titles from MangaFire${result.usedDevice ? ' through this device' : ''}.`); } catch (error) { setSourceResults([]); setNotice(error instanceof Error ? error.message : 'MangaFire is unavailable.'); } finally { setSourceLoading(false); } };
  const openSourceTitle = async (manga: SourceTitle) => { setSourceLoading(true); try { const result = await loadMangaFireTitle(manga.hid); setSourceDetails({ manga: result.manga, chapters: result.chapters }); if (result.usedDevice) setNotice('MangaFire details loaded through this device.'); } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not load manga details.'); } finally { setSourceLoading(false); } };
  const addSourceTitle = async () => { if (!sourceDetails) return; setSourceLoading(true); try { const { manga, chapters } = sourceDetails; const chapterCount = new Set(chapters.map(chapter => chapter.number)).size; const sourceUrl = `/title/${manga.hid}${manga.slug ? `-${manga.slug}` : ''}`; const item: Manga = { id: `source:mangafire:${manga.hid}`, title: manga.title, source: 'MangaFire', sourceUrl, coverUrl: manga.poster?.large ?? manga.poster?.medium ?? manga.poster?.small, category: 'Unread', categories: ['Unread'], chapters: chapterCount, unread: chapterCount, progress: 0, color: 'coral' }; const response = await fetch('/api/library', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ manga: [item] }) }); if (!response.ok) throw new Error('Could not add this title to the library.'); const libraryResponse = await fetch('/api/library'); if (!libraryResponse.ok) throw new Error('Title was added, but the library could not be refreshed.'); const normalised = normaliseRemoteLibrary(((await libraryResponse.json()) as { manga?: Manga[] }).manga ?? []); setLibrary(normalised); setCategories(orderedCategories(normalised.flatMap(entry => entry.categories ?? [entry.category]))); setNotice(`Added ${manga.title} to your library.`); setSourceDetails(null); } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not add this title.'); } finally { setSourceLoading(false); } };
  const importBackup = async (event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (!file) return; try { const imported = file.name.toLowerCase().endsWith('.tachibk') || file.name.toLowerCase().endsWith('.proto.gz') ? await decodeMihonBackup(file) : normaliseBackup(JSON.parse(await file.text())); if (!imported.length) throw new Error('This backup has no readable library titles.'); const cloud = await fetch('/api/library', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ manga: imported }) }); if (!cloud.ok) throw new Error('Cloud import failed.'); const importResult = await cloud.json() as { imported?: number; skippedAliases?: number }; const [libraryResponse, duplicatesResponse] = await Promise.all([fetch('/api/library'), fetch('/api/library/duplicates')]); if (!libraryResponse.ok || !duplicatesResponse.ok) throw new Error('Import completed, but refreshing the library failed.'); const normalised = normaliseRemoteLibrary(((await libraryResponse.json()) as { manga?: Manga[] }).manga ?? []); setLibrary(normalised); setCategories(orderedCategories(normalised.flatMap(item => item.categories ?? [item.category]))); setDuplicateGroups(normaliseDuplicateGroups(((await duplicatesResponse.json()) as { groups?: DuplicateGroup[] }).groups ?? [])); setNotice(`Imported ${importResult.imported ?? imported.length} titles${importResult.skippedAliases ? `; kept ${importResult.skippedAliases} previous merge choices` : ''}.`); setView('library'); } catch (error) { setNotice(error instanceof Error ? `Import failed: ${error.message}` : 'Import failed.'); } event.target.value = ''; };
  const nav = [{ id: 'library' as const, label: 'Library', icon: '▦', count: library.length }, { id: 'updates' as const, label: 'Updates', icon: '↻', count: unread }, { id: 'browse' as const, label: 'Browse', icon: '⌕' }, { id: 'history' as const, label: 'History', icon: '◷' }];

  const signIn = async () => { const response = await fetch('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) }); if (response.ok) { setAuthenticated(true); setPassword(''); } else setAuthError('Incorrect passcode.'); };
  if (authenticated === false) return <main className="auth-screen"><section className="auth-card"><span className="brand-mark">M</span><h1>Mori</h1><p>Your private reading library.</p><input type="password" value={password} onChange={event => setPassword(event.target.value)} onKeyDown={event => event.key === 'Enter' && signIn()} placeholder="Passcode" autoFocus/><button className="primary-button" onClick={signIn}>Unlock library</button>{authError && <small>{authError}</small>}</section></main>;
  if (authenticated === null) return <main className="auth-screen"><p>Opening Mori…</p></main>;
  if (view === 'reader' && selected && readerChapter) return <main className="reader">
    <header className={`reader-bar reader-controls ${readerControls ? 'visible' : ''}`}><button onClick={() => setView(previousView)}>← Back</button><div><strong>{selected.title}</strong><span>{selected.source} · Chapter {readerChapter.number}</span></div><button onClick={markRead}>Mark read</button></header>
    <section className="webtoon-pages" aria-label="Continuous vertical reader">{readerPages.map((page, index) => <img className="reader-image" id={`reader-page-${index}`} data-page={index} key={`${readerChapter.id}:${index}`} src={page} alt={`Page ${index + 1}`}/>)}<div className="reader-end">End of chapter · Progress saved</div></section>
    <nav className="reader-tap-zones" aria-label="Reader navigation"><button aria-label="Previous page" onClick={() => jumpToPage(readerPage - 1)}/><button aria-label="Show or hide reader controls" onClick={() => readerControls ? setReaderControls(false) : revealReaderControls()}/><button aria-label="Next page" onClick={() => jumpToPage(readerPage + 1)}/></nav>
    <footer className={`reader-progress reader-controls ${readerControls ? 'visible' : ''}`}><span>{readerPage + 1}</span><input aria-label="Page" type="range" min="0" max={Math.max(0, readerPages.length - 1)} value={readerPage} onChange={event => jumpToPage(Number(event.target.value))}/><span>{readerPages.length}</span></footer>
  </main>;

  return <main className="app-shell"><aside className="sidebar"><div className="brand"><span className="brand-mark">M</span><span>Mori</span></div><p className="eyebrow">Your reading space</p><nav className="nav-list" aria-label="Main navigation">{nav.map(item => <button key={item.id} className={view === item.id ? 'nav-item active' : 'nav-item'} onClick={event => handleNavigation(item.id, event.detail)}><i>{item.icon}</i><span>{item.label}</span>{item.count !== undefined && <b className={item.id === 'updates' && item.count ? 'alert' : ''}>{item.count}</b>}</button>)}</nav><div className="sidebar-bottom"><button className="sidebar-refresh" onClick={checkUpdates}>↻ Refresh library</button><small>Updates run when you choose to refresh.</small></div></aside>
    <section className="content"><header className="topbar"><div><span className="breadcrumb">Mori / {view[0].toUpperCase() + view.slice(1)}</span><strong className="mobile-brand">Mori</strong></div><div className="top-actions">{view === 'library' && <input className="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search library"/>}<button className="theme-toggle" onClick={toggleTheme} aria-label="Toggle dark mode">{theme === 'light' ? '☾' : '☀'}</button>{view === 'library' && <button className="primary-button" onClick={() => fileInput.current?.click()}>↑ Import</button>}<input ref={fileInput} type="file" accept=".tachibk,.proto.gz,.json,application/gzip,application/json" onChange={importBackup} hidden/></div></header>
      <div className="content-inner"><div className="notice" role="status">{notice}</div>
        {view === 'library' && <>
          <div className="screen-heading"><div><p className="section-kicker">Your collection</p><h1>Library</h1><p>Pick up where you left off.</p></div><div className="heading-actions"><button className="refresh-button" onClick={reviewDuplicates}>Review duplicates{duplicateGroups.length ? ` (${duplicateGroups.length})` : ''}</button><button className="refresh-button" onClick={checkUpdates}>↻ Refresh</button></div></div>
          <section className="library-layout">
            <aside className="categories"><div><p className="section-kicker">Categories</p><button onClick={addCategory}>+ Add</button></div>{categories.map(item => <button key={item} className={category === item ? 'category active' : 'category'} onClick={() => setCategory(item)}>{item}<span>{item === 'All' ? library.length : library.filter(manga => belongsToCategory(manga, item)).length}</span></button>)}</aside>
            <section className="library-panel"><div className="panel-heading"><div><p className="section-kicker">{category}</p><h2>{filtered.length} title{filtered.length === 1 ? '' : 's'}</h2></div></div><div className="manga-grid">{filtered.map(manga => <article className="manga-card" key={manga.id}><Cover manga={manga} onClick={() => void openMangaDetails(manga)}/><div><strong title={manga.title}>{shortTitle(manga.title)}</strong><small>{manga.source} · {manga.chapters} chapters</small><div className="progress"><i style={{ width: `${manga.progress}%` }}/></div><span>{manga.unread ? `${manga.unread} unread` : `${manga.progress}% read`}</span></div><button className="read-button" onClick={() => void openMangaDetails(manga)}>Chapters</button></article>)}{!filtered.length && <p className="empty">Nothing matches this category.</p>}</div></section>
          </section>
        </>}
        {view === 'details' && selected && <section className="manga-details-screen">
          <header className="manga-details-hero"><Cover manga={selected} onClick={() => {}}/><div><button className="details-back" onClick={() => setView('library')}>← Back</button><p className="section-kicker">{selected.source}</p><h1>{selected.title}</h1><p>{selectedChapters.length || selected.chapters} unique chapters · {selected.unread} unread</p><label>Category<select value={displayCategory(selected.categories?.[0] ?? selected.category)} onChange={event => void changeMangaCategory(selected, event.target.value)}>{categories.filter(item => item !== 'All').map(item => <option key={item} value={item}>{item}</option>)}</select></label><button className="remove-title" onClick={() => void removeFromLibrary(selected)}>Remove from library</button></div></header>
          <div className="chapter-heading"><div><p className="section-kicker">Chapters</p><h2>{selectedChapters.length} unique releases</h2></div><small>Duplicate uploads are merged by chapter number.</small></div>
          <div className="chapter-list">{selectedChapters.map(chapter => <button key={chapter.id} className={selected.lastChapterNumber === chapter.number ? 'chapter-row current' : 'chapter-row'} onClick={() => void openChapter(selected, chapter, selected.lastChapterId === String(chapter.id) ? selected.lastPage ?? 0 : 0)}><span><strong>Chapter {chapter.number}</strong>{chapter.name && chapter.name !== `Chapter ${chapter.number}` && <small>{chapter.name}</small>}</span><span>{chapter.type || selected.source}{selected.lastChapterNumber === chapter.number ? ` · Page ${(selected.lastPage ?? 0) + 1}` : ''}</span></button>)}{chapterLoading && <p className="empty">Loading chapters…</p>}{!chapterLoading && !selectedChapters.length && <p className="empty">No chapter list is available for this source yet.</p>}</div>
          <div className="resume-dock"><button className="primary-button" disabled={chapterLoading || !selectedChapters.length} onClick={() => resumeManga(selected)}>▶ {selected.lastChapterId ? `Resume chapter ${selected.lastChapterNumber}, page ${(selected.lastPage ?? 0) + 1}` : 'Start reading'}</button></div>
        </section>}
        {view === 'duplicates' && <><div className="screen-heading"><div><p className="section-kicker">Library cleanup</p><h1>Review duplicates</h1><p>Choose the entry whose source and title Mori should keep.</p></div><button className="refresh-button" onClick={() => open('library')}>Back to library</button></div>{duplicatesLoading ? <section className="feed-panel"><p className="empty">Checking your library…</p></section> : <section className="duplicate-list">{duplicateGroups.map(group => <article className={`duplicate-group ${group.confidence}`} key={group.id}><header><div><strong>{group.confidence === 'strong' ? 'Strong match' : 'Needs review'}</strong><span>{group.reason}</span></div><small>{group.items.length} entries</small></header><div className="duplicate-options">{group.items.map(item => <div className="duplicate-option" key={item.id}><Cover manga={item} onClick={() => {}}/><div><strong>{item.title}</strong><small>{item.source} · {item.chapters} chapters</small><span>{item.unread ? `${item.unread} unread` : `${item.progress}% read`} · {(item.categories ?? []).join(', ') || 'Uncategorized'}</span></div><button className="primary-button" disabled={mergingGroup === group.id} onClick={() => mergeDuplicateGroup(group, item)}>{mergingGroup === group.id ? 'Merging…' : 'Keep this'}</button></div>)}</div></article>)}{!duplicateGroups.length && <section className="feed-panel"><p className="empty">No duplicate candidates remain.</p></section>}</section>}</>}
        {view === 'updates' && <><div className="screen-heading"><div><p className="section-kicker">Manual refresh</p><h1>Updates</h1><p>New chapters from your library.</p></div><button className="refresh-button" onClick={checkUpdates}>↻ Refresh</button></div><section className="feed-panel">{library.filter(manga => manga.unread).map(manga => <article className="feed-row" key={manga.id}><Cover manga={manga} onClick={() => void openMangaDetails(manga)}/><div><strong>{manga.title}</strong><small>{manga.source}</small><p>{manga.unread} new chapter{manga.unread > 1 ? 's' : ''} available</p></div><button className="read-button" onClick={() => resumeManga(manga)}>Read</button></article>)}{!unread && <p className="empty">You are all caught up. Refresh when you want to check again.</p>}</section></>}
        {view === 'browse' && <>
          <div className="screen-heading"><div><p className="section-kicker">Your adapters</p><h1>Browse</h1><p>Search MangaFire and add live titles to Mori.</p></div></div>
          <section className="source-grid">{availableSources.map(source => <button key={source} className={sources.includes(source) ? 'source-card selected' : 'source-card'} onClick={() => setSources(current => current.includes(source) ? current.filter(item => item !== source) : [...current, source])}><span className="source-initial">{source[0]}</span><span><strong>{source}</strong><small>{source === 'MangaFire' ? 'Live adapter' : sources.includes(source) ? 'Selected for later' : 'Not connected yet'}</small></span><b>{sources.includes(source) ? '✓' : '+'}</b></button>)}</section>
          <section className="source-browser">
            <header><div><p className="section-kicker">MangaFire</p><h2>Live catalog</h2></div><div className="source-search"><input value={sourceQuery} onChange={event => setSourceQuery(event.target.value)} onKeyDown={event => event.key === 'Enter' && void browseMangaFire('search')} placeholder="Search MangaFire"/><button className="primary-button" onClick={() => void browseMangaFire('search')}>Search</button></div></header>
            <div className="source-tabs"><button className={sourceMode === 'popular' ? 'active' : ''} onClick={() => void browseMangaFire('popular')}>Popular</button><button className={sourceMode === 'latest' ? 'active' : ''} onClick={() => void browseMangaFire('latest')}>Latest</button></div>
            <div className="source-results">{sourceResults.map(manga => <button key={manga.hid} className="source-result" onClick={() => void openSourceTitle(manga)} aria-label={`View ${manga.title}`}>{manga.poster?.medium ? <img src={manga.poster.medium} alt="" loading="lazy"/> : <span>{manga.title[0]}</span>}<strong title={manga.title}>{shortTitle(manga.title)}</strong><small>{manga.latestChapter ? `Latest chapter ${manga.latestChapter}` : manga.type || 'View details'}</small></button>)}</div>
            {sourceLoading && <p className="empty">Loading MangaFire…</p>}
            {!sourceLoading && !sourceResults.length && <div className="browse-empty"><span>⌕</span><h2>Open the MangaFire catalog</h2><p>Choose Popular or Latest, or search for a title.</p></div>}
          </section>
          {sourceDetails && <div className="source-modal" role="presentation" onClick={event => { if (event.target === event.currentTarget) setSourceDetails(null); }}>
            <article className="source-detail" role="dialog" aria-modal="true" aria-labelledby="source-detail-title">
              <button className="detail-close" onClick={() => setSourceDetails(null)} aria-label="Close manga details" autoFocus>×</button>
              {sourceDetails.manga.poster?.large ? <img src={sourceDetails.manga.poster.large} alt=""/> : <span className="source-detail-cover">{sourceDetails.manga.title[0]}</span>}
              <div><p className="section-kicker">{sourceDetails.manga.type || 'Manga'} · {sourceDetails.manga.status || 'Unknown status'}</p><h2 id="source-detail-title">{sourceDetails.manga.title}</h2><small>{sourceDetails.manga.authors?.map(author => author.title).join(', ') || 'Unknown author'} · {new Set(sourceDetails.chapters.map(chapter => chapter.number)).size} chapters</small><p>{sourceDetails.manga.synopsisHtml?.replace(/<[^>]+>/g, ' ') || 'No description available.'}</p><button className="primary-button" onClick={() => void addSourceTitle()} disabled={sourceLoading}>{library.some(item => item.id === `source:mangafire:${sourceDetails.manga.hid}`) ? 'Update library entry' : 'Add to library'}</button></div>
            </article>
          </div>}
        </>}
        {view === 'history' && <><div className="screen-heading"><div><p className="section-kicker">Resume reading</p><h1>History</h1><p>Double-tap History to resume the latest entry.</p></div></div><section className="feed-panel">{history.map(manga => <article className="feed-row" key={manga.id}><Cover manga={manga} onClick={() => void openMangaDetails(manga)}/><div><strong>{manga.title}</strong><small>Chapter {manga.lastChapterNumber ?? Math.max(1, manga.chapters - manga.unread + 1)} · Page {(manga.lastPage ?? 0) + 1}</small><p>Read {relativeTime(manga.lastRead)}</p></div><button className="read-button" onClick={() => resumeManga(manga)}>Continue</button></article>)}{!history.length && <p className="empty">Open a chapter and it will appear here.</p>}</section></>}
      </div></section><nav className="bottom-nav" aria-label="Main navigation">{nav.map(item => <button key={item.id} className={view === item.id ? 'active' : ''} onClick={event => handleNavigation(item.id, event.detail)}><i>{item.icon}</i><span>{item.label}</span>{item.id === 'updates' && unread > 0 && <b>{unread}</b>}</button>)}</nav></main>;
}
