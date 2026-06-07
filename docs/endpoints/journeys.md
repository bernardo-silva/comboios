# POST /cp/services/travel-api/journeys

Searches for train journeys between two stations on a given date.

**URL:** `https://api-gateway.cp.pt/cp/services/travel-api/journeys`

## Headers

- `Content-Type: application/json`
- `x-api-key: ca3923e4-1d3c-424f-a3d0-9554cf3ef859`
- `x-cp-connect-id: 1483ea620b920be6328dcf89e808937a`
- `x-cp-connect-secret: 74bd06d5a2715c64c2f848c5cdb56e6b`

## Request body

```json
{
  "departureStationCode": "94-31039",
  "arrivalStationCode": "94-2006",
  "classes": [2],
  "configID": 200,
  "lang": "EN",
  "quantities": [{ "quantity": 1, "type": 1 }],
  "returnDate": null,
  "returnTimeLimit": { "endTime": "23:59", "limitType": 0, "startTime": "00:00" },
  "saleableOnly": false,
  "searchType": 3,
  "services": [],
  "timeLimit": { "endTime": "23:59", "limitType": 0, "startTime": "00:00" },
  "travelDate": "2026-06-08",
  "username": "sivNetticket"
}
```

Only `departureStationCode`, `arrivalStationCode`, and `travelDate` (format `YYYY-MM-DD`)
vary per search; the rest are fixed defaults for a single adult, 2nd class, one-way search.

## Response (relevant fields)

```json
{
  "departureStation": { "code": "94-31039", "designation": "Lisboa Oriente" },
  "arrivalStation": { "code": "94-2006", "designation": "Porto Campanha" },
  "outwardTrip": [
    {
      "departureTime": "06:39",
      "arrivalTime": "09:43",
      "duration": "03h04",
      "services": "IC",
      "transferCount": 0,
      "basePrices": [{ "travelClass": 2, "priceType": 1, "centsValue": 2805 }],
      "travelSections": [
        {
          "trainNumber": 521,
          "serviceCode": { "code": "IC", "designation": "Intercidades" },
          "departureStation": { "code": "94-31039", "designation": "Lisboa Oriente" },
          "arrivalStation": { "code": "94-2006", "designation": "Porto Campanha" }
        }
      ]
    }
  ],
  "returnTrip": [],
  "messages": []
}
```

`outwardTrip` is an array of journeys for the requested travel date. Each journey has
a departure/arrival time, duration, the operating service code(s) (e.g. `IC`,
`AP`, `R`, `U`), the number of transfers, and a list of base prices per travel class
(price is in cents). `travelSections` breaks the journey down per leg (relevant for
journeys with transfers) and carries the `trainNumber`, `serviceCode`, and
departure/arrival stations needed to book the journey via the
[sale endpoint](sale.md).
