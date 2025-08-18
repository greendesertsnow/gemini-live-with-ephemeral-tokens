import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { location, units = 'celsius' } = await request.json();
    
    if (!location) {
      return NextResponse.json(
        { error: 'Location is required' },
        { status: 400 }
      );
    }

    // Mock weather data - in a real implementation, you'd call a weather API
    const weatherData = {
      location,
      temperature: units === 'celsius' ? 22 : 72,
      description: 'Partly cloudy',
      humidity: 65,
      windSpeed: 10,
      units: units === 'celsius' ? '°C' : '°F',
      timestamp: new Date().toISOString()
    };

    // Log the weather request
    console.log(`Weather requested for ${location} in ${units}:`, weatherData);

    return NextResponse.json(weatherData);
  } catch (error) {
    console.error('Weather API error:', error);
    return NextResponse.json(
      { error: 'Failed to get weather data' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const location = searchParams.get('location');
  const units = searchParams.get('units') || 'celsius';

  if (!location) {
    return NextResponse.json(
      { error: 'Location parameter is required' },
      { status: 400 }
    );
  }

  // Mock weather data
  const weatherData = {
    location,
    temperature: units === 'celsius' ? 22 : 72,
    description: 'Partly cloudy',
    humidity: 65,
    windSpeed: 10,
    units: units === 'celsius' ? '°C' : '°F',
    timestamp: new Date().toISOString()
  };

  console.log(`Weather requested for ${location} in ${units}:`, weatherData);

  return NextResponse.json(weatherData);
}