import { getAthleteLocation } from "@/lib/athlete-data";

/**
 * One-line, session-relevant weather hint for today. Renders nothing unless
 * the athlete has a location in data/app/athlete-context.json AND the
 * forecast crosses a threshold that should change how the session is run
 * (heat ≥ 28°C, rain probability ≥ 50%, wind ≥ 30 km/h). A failed fetch
 * renders nothing — never breaks the page.
 */

interface DailyForecast {
  tMax: number | null;
  rainProb: number | null;
  windMax: number | null;
}

async function fetchToday(lat: number, lon: number): Promise<DailyForecast | null> {
  try {
    const url =
      "https://api.open-meteo.com/v1/forecast" +
      `?latitude=${lat}&longitude=${lon}` +
      "&daily=temperature_2m_max,precipitation_probability_max,wind_speed_10m_max" +
      "&wind_speed_unit=kmh&timezone=America%2FNew_York&forecast_days=1";
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      daily?: {
        temperature_2m_max?: (number | null)[];
        precipitation_probability_max?: (number | null)[];
        wind_speed_10m_max?: (number | null)[];
      };
    };
    return {
      tMax: j.daily?.temperature_2m_max?.[0] ?? null,
      rainProb: j.daily?.precipitation_probability_max?.[0] ?? null,
      windMax: j.daily?.wind_speed_10m_max?.[0] ?? null,
    };
  } catch {
    return null;
  }
}

export async function WeatherHint() {
  const loc = getAthleteLocation();
  if (!loc) return null;
  const fc = await fetchToday(loc.lat, loc.lon);
  if (!fc) return null;

  const notes: string[] = [];
  if (fc.tMax != null && fc.tMax >= 28)
    notes.push(`${Math.round(fc.tMax)}°C peak — go early, add fluids, expect HR drift`);
  if (fc.rainProb != null && fc.rainProb >= 50)
    notes.push(`${Math.round(fc.rainProb)}% rain — have an indoor option ready`);
  if (fc.windMax != null && fc.windMax >= 30)
    notes.push(`wind to ${Math.round(fc.windMax)} km/h — ride into it out, home with it back`);
  if (notes.length === 0) return null;

  return (
    <p className="label-mono text-bone-faint mt-3">
      Weather today · {notes.join(" · ")}
    </p>
  );
}
