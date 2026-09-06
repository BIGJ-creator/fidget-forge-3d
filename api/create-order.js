export default async function handler(req, res) {
  try {
    const orderId = req.query.token;

    if (!orderId) {
      return res.status(400).send("Missing PayPal order ID.");
    }

    const clientId = process.env.PAYPAL_CLIENT_ID;
    const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return res.status(500).send("PayPal credentials are missing.");
    }

    const paypalBase =
      process.env.PAYPAL_ENV === "live"
        ? "https://api-m.paypal.com"
        : "https://api-m.sandbox.paypal.com";

    // Get PayPal access token
    const authResponse = await fetch(
      `${paypalBase}/v1/oauth2/token`,
      {
        method: "POST",
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(
              `${clientId}:${clientSecret}`
            ).toString("base64"),
          "Content-Type":
            "application/x-www-form-urlencoded"
        },
        body: "grant_type=client_credentials"
      }
    );

    const authData = await authResponse.json();

    if (!authResponse.ok) {
      console.error("PAYPAL AUTH ERROR:", authData);
      return res.status(500).send("PayPal authentication failed.");
    }

    const accessToken = authData.access_token;

    // Capture the approved PayPal order
    const captureResponse = await fetch(
      `${paypalBase}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "PayPal-Request-Id": `capture-${orderId}`
        },
        body: "{}"
      }
    );

    const captureData = await captureResponse.json();

    console.log(
      "PAYPAL CAPTURE STATUS:",
      captureResponse.status
    );

    console.log(
      "PAYPAL CAPTURE RESPONSE:",
      JSON.stringify(captureData, null, 2)
    );

    if (!captureResponse.ok) {
      console.error(
        "PAYPAL CAPTURE ERROR:",
        captureData
      );

      return res.status(500).send(
        "PayPal payment could not be completed."
      );
    }

    if (captureData.status === "COMPLETED") {
      return res.redirect(
        `/?payment=success&order=${encodeURIComponent(orderId)}`
      );
    }

    return res.status(400).send(
      `Payment was not completed. PayPal status: ${captureData.status}`
    );

  } catch (error) {
    console.error(
      "PAYPAL RETURN ERROR:",
      error
    );

    return res.status(500).send(
      "Something went wrong while completing the payment."
    );
  }
}
