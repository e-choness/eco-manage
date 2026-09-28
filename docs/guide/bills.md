# Bills and tariffs

EcoManage works out the site's bill the way the utility does, from the site's own tariff and its
15-minute intervals, so you can see the month so far, where it's heading and what solar and the
battery saved, and check the utility's bill against it. Bills are for owners and managers.

![Bills](/screenshots/bills.png){.shot}

## The Bills page

- **The last 12 months:** total spent, total saved, the highest demand and what it cost, and how
  close the estimates came to the utility's bills.
- **Every bill** as stacked bars (energy, demand, fixed; the open period dashed) and as a list
  showing where each utility bill stands.
- **The selected period** (`?period=`): each line of the bill, the tariff that priced it, the peak
  and when it happened, grid energy, any estimated stretches, and the saving.
- **Spending for any dates:** energy cost, export credit, grid energy and the highest demand for a
  range of up to a year. It has no demand charge, which is charged once per billing period.
- **Downloads:** the statement as a PDF, and the period's 15-minute data as CSV. **Open in
  History** shows the same dates there.

The open period is recomputed as intervals arrive, and every bill is recomputed each night at 1 am
site time, so late readings are always included.

## How a bill is made

A billing period starts on the site's **bill day** (1 to 28) and runs to the day before the next
one. Its total is:

> energy in each time-of-use period × that period's rate
> \+ the period's highest demand × the demand rate
> \+ the fixed fee
> − exported energy × the export rate

- **Energy** is priced interval by interval with the tariff version in force on that day, and
  summed exactly before each line is rounded to the cent.
- **Demand** is the highest 15- or 30-minute average import in the period (the tariff says which),
  charged at the demand rate in force on the period's last day.
- **The projection** for the open period scales energy and export so far to the whole period, and
  adds demand at today's peak and the fixed fee.
- **Estimated share:** how much of the period rests on estimated intervals. A bill with gaps no
  tariff covers says so.

## Demand

Demand charges reward a flat load: one busy quarter hour sets the charge for the month. That's why
Home shows demand against the **cap**, why an alert opens when an interval is heading for 90% of
it, and why several [recommendations](./inbox.md#the-rules) aim at the peak (discharge the battery,
limit EV charging, pre-heat before the peak).

## Savings

Once a site has 7 days of data, each bill shows what it saved against the same building with no
solar and no battery, on the same tariff:

- **Solar:** the solar energy used on site, at the price it would have cost, plus the credit for
  what was exported.
- **Battery shifting:** energy discharged in dear periods minus energy charged in cheap ones, at
  their prices.
- **Demand avoided:** how much lower the peak was than it would have been, at the demand rate.

A peak-shaving recommendation that was carried out also gets its **measured saving** the day after:
the demand charge without the battery's discharge minus the one with it.

## The utility's bill

Once a period is closed, the owner can add the utility's own bill to compare:

- **Upload the PDF** (up to 10 MB). EcoManage reads the total from lines such as "Total amount
  due", "Amount due", "Total due", "Balance due" or "Total new charges".
- **Upload a CSV** with a `total_due` column (or `total`, `amount_due`), and optionally `period`.
- **Type the total** in, if the file can't be read (the page offers this when it fails).

The period then shows the difference, ours minus the utility's. A big difference usually means a
tariff detail is missing or wrong.

## Tariffs

The owner sets up the tariff in [Settings → Tariff](./settings.md#tariff). Managers can view it.

- **Seasons** by month (a season may wrap the year end, for example November to March).
- **Periods** in each season, for weekdays, weekends or all days, each with a start, an end and a
  rate in cents per kWh. Times are local; an end at or before the start means midnight, so
  `00:00`–`00:00` is the whole day. An overnight rate is two periods.
- **Every hour of every day type in every month must be covered exactly once.** The editor shows
  gaps and overlaps as you type, and the server refuses a tariff that has any.
- **Demand rate** per kW per period, over 15 or 30 minutes; **export rate**; **fixed fee** per
  period; **holidays**, treated as weekends or weekdays.
- **Templates:** Commercial TOU-D and Flat, to start from.

A saved change is a new **version** starting on a date you choose, no earlier than the start of the
current billing period, so closed bills never change. Each day is priced with the version in force
on it.
