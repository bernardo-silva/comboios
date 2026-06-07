# POST /cp/services/ticketing-api/sale

Creates a pending ticket sale for a chosen journey.

**URL:** `https://api-gateway.cp.pt/cp/services/ticketing-api/sale`

## Headers

- `Content-Type: application/json`
- `X-Api-Key: 12547ba7-8c45-45ee-948a-c03cf5be03d1`
- `x-cp-connect-id: 1483ea620b920be6328dcf89e808937a`
- `x-cp-connect-secret: 74bd06d5a2715c64c2f848c5cdb56e6b`

## Request body

```json
{
  "quantity": 1,
  "travelClass": { "code": "2" },
  "travelDate": "2026-06-08",
  "outwardTrip": [
    {
      "trainNumber": 521,
      "departureStation": { "code": "94-31039" },
      "arrivalStation": { "code": "94-2006" },
      "serviceCode": { "code": "IC", "designation": "Intercidades" }
    }
  ],
  "lang": "en"
}
```

`outwardTrip` describes each leg of the outward journey: the train number, the
departure/arrival station codes, and the operating service (e.g. `IC`, `AP`, `R`,
`U`). `travelClass.code` is `"1"` or `"2"`, `quantity` is the number of
passengers, and `travelDate` is `YYYY-MM-DD`.

## Response (relevant fields)

```json
{
  "operation": "SALE",
  "saleID": 106179893,
  "reference": "CP-JFDC9I1PT952",
  "status": { "code": "PENDING", "designation": "Pendente" },
  "totalAmount": "€ 28,05",
  "travelData": {
    "departure": { "code": "94-31039", "designation": "Lisboa Oriente" },
    "arrival": { "code": "94-2006", "designation": "Porto Campanha" },
    "outwardTrip": [
      {
        "trainNumber": 521,
        "departureTime": "06:39",
        "arrivalTime": "09:43",
        "duration": "03h04",
        "seatData": [
          { "trainNumber": 521, "carriageNumber": 24, "seatNumber": 113 }
        ]
      }
    ]
  }
}
```

The sale starts out `PENDING` and is identified by `saleID`/`reference`; a seat is
already assigned per leg in `seatData`. `totalAmount` is a formatted price string
(e.g. `"€ 28,05"`). Presumably a further step (not yet explored) confirms/pays for
the pending sale.
