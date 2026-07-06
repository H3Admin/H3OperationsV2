### Phone Answering Service Schema

This document outlines the data structure for the phone answering service.

**Collection:** `calls`

**Fields:**

*   `id`: `string` (unique identifier)
*   `created_at`: `timestamp` (automatically generated)
*   `from_number`: `string` (the caller's phone number)
*   `to_number`: `string` (the number that was called)
*   `duration_seconds`: `number` (the duration of the call in seconds)
*   `recording_url`: `string` (URL to the call recording, optional)
*   `status`: `string` (Enum: `answered`, `missed`, `voicemail`)
*   `notes`: `string` (free-form text for notes, optional)

**Collection:** `messages`

**Fields:**

*   `id`: `string` (unique identifier)
*   `created_at`: `timestamp` (automatically generated)
*   `from_number`: `string` (the sender's phone number)
*   `to_number`: `string` (the recipient's phone number)
*   `body`: `string` (the content of the message)
*   `status`: `string` (Enum: `received`, `read`)
