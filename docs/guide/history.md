# History and reports

History shows the site's energy (and, for owners and managers, its cost) over any range, from the
permanent record of every 15-minute interval.

![History](/screenshots/history.png){.shot}

## Choosing a range

- **Presets:** today, 7 days, this month, last month, this year, all data, or custom dates.
  Dates can't go before the site's first data or after today.
- **Resolution:** Auto, 15 minutes, hourly, daily, weekly (from Monday) or monthly. Auto picks
  hourly up to 2 days, daily up to 92 days, weekly up to 400 days, and monthly beyond.
- **Compare** with the previous period of the same length, or the same dates last year.

A range or resolution that would draw more than 400 bars falls back to Auto, and a range outside
the data is moved into it; either way the page says so and shows the range it actually drew.

## What's on the page

**Totals:** solar produced, bought from the grid, sold to the grid, highest demand and energy
cost, each with its change
against the comparison. Installers see the four energy totals only.

**Four views,** as stacked bars:

- **Energy sources:** solar used on site, the battery and grid import.
- **Consumers:** the building (calculated as what's left once the measured loads are taken out),
  the heat pump and EV charging.
- **Demand:** the highest 15-minute demand in each bar, with the cap as a line.
- **Energy cost:** the time-of-use energy cost of each bar (the demand charge and fixed fees are
  per billing period, so they're on [Bills](./bills.md)).

Bars that include estimated intervals are outlined with a dashed line. Every chart has the same
numbers in a table for screen readers. Bars start at local midnight, on the hour or the quarter
hour, on Monday or on the 1st, in the site's time zone, so they line up with the site's days even
when the clocks change.

## Exporting a CSV

**Export CSV** writes every 15-minute interval in the range: the start in site time and in UTC,
kWh for each source and consumer, demand, and (for owners and managers) cost and export credit, and
the data quality. The page downloads it when it's ready. Ranges over a year are also emailed to you
as a link, since they take longer.

## Reports

A report is a saved set of sections for a range, sent by email as a PDF, a CSV or an Excel file.
**Create report** starts from the range on screen:

- **Sections:** energy summary, sources and consumers, demand peaks, energy cost (not for
  installers), device availability, decisions and commands, and alerts.
- **Schedule:** once, weekly (every Monday at 07:00 site time, covering the previous Monday to
  Sunday) or monthly (the 1st at 07:00, covering the previous month).
- **Recipients** (a scheduled report needs at least one) and notes printed on it.

Each run is emailed to the recipients as a link that works without signing in for 30 days. The
list shows every report with its status, the dates its latest file covers, and the next run. A
report runs with its creator's access at the time: money only if they may see it, and nothing at
all once they have left the site. Its creator or the owner can remove it, which stops its schedule
and its links.

## Where the numbers come from

Each interval's energy is the difference of the devices' own energy counters at its two
boundaries, so a missed reading doesn't lose energy. When a counter is missing the interval uses
average power instead and is marked **estimated**; when the meter is silent for a whole interval,
grid energy is worked out from the balance of the other devices. A reading that arrives late (a
gateway catching up after an outage) updates its interval, and the costs and bills that depend on
it, automatically.
